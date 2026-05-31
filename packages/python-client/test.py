from __future__ import annotations

import asyncio
import os
from contextlib import nullcontext

import aiohttp
import engineio

import plugin_remote
import rpc_reader
from plugin_remote import DeviceManager, MediaManager, SystemManager
from scrypted_python.scrypted_sdk import ScryptedInterface, ScryptedStatic


class EioRpcTransport(rpc_reader.RpcTransport):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self.eio = engineio.AsyncClient(ssl_verify=False)
        self.loop = loop
        self.write_error: Exception = None
        self.read_queue = asyncio.Queue()
        self.write_queue = asyncio.Queue()

        @self.eio.on("message")
        def on_message(data):
            self.read_queue.put_nowait(data)

        asyncio.run_coroutine_threadsafe(self.send_loop(), self.loop)

    async def read(self):
        return await self.read_queue.get()

    async def send_loop(self):
        while True:
            data = await self.write_queue.get()
            try:
                await self.eio.send(data)
            except Exception as e:
                self.write_error = e
                self.write_queue = None
                break

    def writeBuffer(self, buffer, reject):
        async def send():
            try:
                if self.write_error:
                    raise self.write_error
                self.write_queue.put_nowait(buffer)
            except Exception as e:
                reject(e)

        asyncio.run_coroutine_threadsafe(send(), self.loop)

    def writeJSON(self, json, reject):
        return self.writeBuffer(json, reject)


async def connect_scrypted_client(
    transport: EioRpcTransport,
    base_url: str,
    username: str,
    password: str,
    plugin_id: str = "@scrypted/core",
    session: aiohttp.ClientSession | None = None,
) -> ScryptedStatic:
    login_url = f"{base_url}/login"
    login_body = {
        "username": username,
        "password": password,
    }

    if session:
        cm = nullcontext(session)
    else:
        cm = aiohttp.ClientSession()

    async with cm as _session:
        async with _session.post(
            login_url, verify_ssl=False, json=login_body
        ) as response:
            login_response = await response.json()

        headers = {"Authorization": login_response["authorization"]}

        await transport.eio.connect(
            base_url,
            headers=headers,
            engineio_path=f"/endpoint/{plugin_id}/engine.io/api/",
        )

        ret = asyncio.Future[ScryptedStatic](loop=transport.loop)
        peer, peerReadLoop = await rpc_reader.prepare_peer_readloop(
            transport.loop, transport
        )
        peer.params["print"] = print

        def callback(api, pluginId, hostInfo):
            remote = plugin_remote.PluginRemote(
                peer, api, pluginId, hostInfo, transport.loop
            )
            wrapped = remote.setSystemState

            async def remoteSetSystemState(systemState):
                await wrapped(systemState)

                async def resolve():
                    sdk = ScryptedStatic()
                    sdk.api = api
                    sdk.remote = remote
                    sdk.systemManager = SystemManager(api, remote.systemState)
                    sdk.deviceManager = DeviceManager(
                        remote.nativeIds, sdk.systemManager
                    )
                    sdk.mediaManager = MediaManager(await api.getMediaManager())
                    ret.set_result(sdk)

                asyncio.run_coroutine_threadsafe(resolve(), transport.loop)

            remote.setSystemState = remoteSetSystemState
            return remote

        peer.params["getRemote"] = callback
        asyncio.run_coroutine_threadsafe(peerReadLoop(), transport.loop)

        sdk = await ret
        return sdk


async def main():
    transport = EioRpcTransport(asyncio.get_event_loop())
    sdk = await connect_scrypted_client(
        transport,
        "https://localhost:10443",
        os.environ["SCRYPTED_USERNAME"],
        os.environ["SCRYPTED_PASSWORD"],
    )

    for id in sdk.systemManager.getSystemState():
        device = sdk.systemManager.getDeviceById(id)
        print(device.name)
        if ScryptedInterface.OnOff.value in device.interfaces:
            print(f"OnOff: device is {device.on}")

    await transport.eio.disconnect()
    os._exit(0)


loop = asyncio.new_event_loop()
asyncio.run_coroutine_threadsafe(main(), loop)
loop.run_forever()
