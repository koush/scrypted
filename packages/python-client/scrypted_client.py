"""Client library for connecting to a Scrypted server over engine.io RPC.

Provides :class:`EioRpcTransport` and :func:`connect_scrypted_client`, the
importable equivalent of the bootstrap that previously only existed inline in
test.py. Typical usage::

    transport, sdk = await connect_scrypted_client(
        asyncio.get_event_loop(), "https://localhost:10443", username, password
    )
    for id in sdk.systemManager.getSystemState():
        print(sdk.systemManager.getDeviceById(id).name)
    await transport.close()

Must be called from a running event loop; the transport schedules its send
loop on construction.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

import aiohttp
import engineio

import plugin_remote
import rpc_reader
from cluster_setup import ClusterSetup
from plugin_remote import DeviceManager, MediaManager, SystemManager
from scrypted_python.scrypted_sdk import ScryptedStatic

logger = logging.getLogger(__name__)

DEFAULT_PLUGIN_ID = "@scrypted/core"
DEFAULT_CONNECT_TIMEOUT = 30


class ScryptedConnectionError(Exception):
    """Raised when the Scrypted engine.io connection cannot be established."""


class EioRpcTransport(rpc_reader.RpcTransport):
    """RpcTransport over an engine.io connection."""

    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        super().__init__()
        # When a session is provided, engineio must defer to its connector
        # (ssl_verify=True skips engineio's own ssl.create_default_context,
        # a blocking call some frameworks forbid on the event loop). Only
        # fall back to engineio's ssl_verify=False when we have no session;
        # Scrypted servers use self-signed certificates by default. engineio
        # never closes externally provided sessions, so the transport takes
        # ownership: close() closes the session. Callers that need to keep
        # the session alive should not share it with the transport.
        self._http_session = http_session
        self.eio = engineio.AsyncClient(
            http_session=http_session, ssl_verify=http_session is not None
        )
        self.loop = loop
        self.write_error: Exception | None = None
        self.read_queue: asyncio.Queue = asyncio.Queue()
        self.write_queue: asyncio.Queue = asyncio.Queue()
        self._send_task: asyncio.Task | None = None
        # Set by connect_scrypted_client() so close() can tear it down.
        self.read_task: asyncio.Task | None = None

        @self.eio.on("message")
        def on_message(data):
            self.read_queue.put_nowait(data)

        self._send_task = loop.create_task(self.send_loop())

    async def read(self):
        return await self.read_queue.get()

    async def send_loop(self):
        while True:
            data = await self.write_queue.get()
            try:
                await self.eio.send(data)
            except Exception as e:
                # Any send failure kills the link; surface it on next write.
                self.write_error = e
                break

    def writeBuffer(self, buffer, reject):
        if self.write_error:
            if reject:
                reject(self.write_error)
            return
        self.write_queue.put_nowait(buffer)

    def writeSerialized(self, j, reject):
        # engineio json-encodes dict payloads on send and json-decodes text
        # frames on receive, so messages cross the wire as engine.io JSON
        # packets and arrive at readLoop() already deserialized to dicts.
        return self.writeBuffer(j, reject)

    async def close(self) -> None:
        """Tear the transport down, cancelling background tasks."""
        tasks = [task for task in (self._send_task, self.read_task) if task]
        self._send_task = None
        self.read_task = None
        for task in tasks:
            task.cancel()
        try:
            await self.eio.disconnect()
        except Exception:
            logger.debug("Error disconnecting engine.io client", exc_info=True)
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if self._http_session:
            await self._http_session.close()
            self._http_session = None


async def connect_scrypted_client(
    loop: asyncio.AbstractEventLoop,
    base_url: str,
    username: str,
    password: str,
    plugin_id: str = DEFAULT_PLUGIN_ID,
    login_session: aiohttp.ClientSession | None = None,
    transport: EioRpcTransport | None = None,
    timeout: float = DEFAULT_CONNECT_TIMEOUT,
) -> tuple[EioRpcTransport, ScryptedStatic]:
    """Login and establish the engine.io RPC session.

    Returns ``(transport, sdk)``. The caller owns the transport and must
    ``await transport.close()`` when done. If ``login_session`` is omitted, a
    temporary session with certificate verification disabled is used for the
    login request only; pass a configured session to control TLS behavior.
    Likewise pass a pre-built :class:`EioRpcTransport` to control the
    engine.io connection's session (the transport takes ownership of that
    session and closes it in ``close()``). ``timeout`` bounds each phase of
    the connection: the login request, the engine.io connect, and the wait
    for initial system state. Raises :class:`ScryptedConnectionError` on any
    failure.
    """
    owns_login_session = login_session is None
    session = login_session or aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(ssl=False)
    )
    try:
        try:
            async with session.post(
                f"{base_url}/login",
                json={"username": username, "password": password},
                raise_for_status=True,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                login_response = await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise ScryptedConnectionError(
                f"Login to {base_url} failed: {err}"
            ) from err
        finally:
            if owns_login_session:
                await session.close()

        if "authorization" not in login_response:
            raise ScryptedConnectionError(
                f"Login to {base_url} did not return an authorization header "
                f"(response keys: {sorted(login_response)})"
            )
    except ScryptedConnectionError:
        # A caller-provided transport already owns a session and a running
        # send loop; failing before the engine.io phase must not leak them.
        if transport is not None:
            await transport.close()
        raise

    if transport is None:
        transport = EioRpcTransport(loop)
    try:
        await asyncio.wait_for(
            transport.eio.connect(
                base_url,
                headers={"Authorization": login_response["authorization"]},
                engineio_path=f"/endpoint/{plugin_id}/engine.io/api/",
            ),
            timeout,
        )
    except (engineio.exceptions.ConnectionError, asyncio.TimeoutError) as err:
        await transport.close()
        raise ScryptedConnectionError(f"engine.io connect failed: {err}") from err

    ret: asyncio.Future[ScryptedStatic] = loop.create_future()
    peer, peer_read_loop = await rpc_reader.prepare_peer_readloop(loop, transport)
    peer.params["print"] = logger.debug

    def get_remote(api, plugin_id_, host_info):
        cluster_setup = ClusterSetup(loop, peer)
        remote = plugin_remote.PluginRemote(
            cluster_setup, api, plugin_id_, host_info, loop
        )
        wrapped = remote.setSystemState

        async def remote_set_system_state(system_state):
            await wrapped(system_state)

            async def resolve():
                if ret.done():
                    return
                sdk = ScryptedStatic()
                sdk.api = api
                sdk.remote = remote
                system_manager = SystemManager(api, remote.systemState)
                sdk.systemManager = system_manager
                sdk.deviceManager = DeviceManager(remote.nativeIds, system_manager)
                sdk.mediaManager = MediaManager(await api.getMediaManager())
                if not ret.done():
                    # PluginRemote.notify dispatches events to the attached
                    # systemManager's registry (same wiring as loadZip); this
                    # is what makes systemManager.listen() callbacks fire.
                    remote.systemManager = system_manager
                    ret.set_result(sdk)

            loop.create_task(resolve())

        remote.setSystemState = remote_set_system_state
        return remote

    peer.params["getRemote"] = get_remote
    read_task = loop.create_task(peer_read_loop())
    transport.read_task = read_task

    def on_read_loop_done(task: asyncio.Task) -> None:
        # Surface a dead link immediately instead of waiting for the timeout.
        if ret.done() or task.cancelled():
            return
        err = task.exception()
        ret.set_exception(
            ScryptedConnectionError(
                f"Connection to {base_url} lost during handshake: {err}"
                if err
                else f"Connection to {base_url} closed during handshake"
            )
        )

    read_task.add_done_callback(on_read_loop_done)

    try:
        sdk = await asyncio.wait_for(asyncio.shield(ret), timeout)
    except asyncio.TimeoutError as err:
        await transport.close()
        raise ScryptedConnectionError(
            f"Timed out waiting for Scrypted system state from {base_url}"
        ) from err
    except ScryptedConnectionError:
        await transport.close()
        raise
    return transport, sdk
