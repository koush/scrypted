# Copy this here before it gets populated with the rest of this file's code
base_globals = globals().copy()

import asyncio
import inspect
import prompt_toolkit
from prompt_toolkit import print_formatted_text
from prompt_toolkit.application import Application
import prompt_toolkit.application.current
from prompt_toolkit.application.current import create_app_session
from prompt_toolkit.data_structures import Size
import prompt_toolkit.key_binding.key_processor
from prompt_toolkit.input import create_pipe_input
from prompt_toolkit.output.vt100 import Vt100_Output
from prompt_toolkit.output.color_depth import ColorDepth
from ptpython.repl import embed, PythonRepl
import ptpython.key_bindings
import ptpython.python_input
import ptpython.history_browser
import ptpython.layout
from typing import List, Dict, Any

from scrypted_python.scrypted_sdk import ScryptedStatic, ScryptedDevice

from cluster_setup import cluster_listen_zero
from rpc import maybe_await


# Our client is xtermjs, so no need to perform any color depth detection
ColorDepth.default = lambda *args, **kwargs: ColorDepth.DEPTH_4_BIT


# This section is a bit of a hack - prompt_toolkit has many assumptions
# that there is only one global Application, so multiple REPLs will confuse
# the library. The patches here allow us to scope a particular call stack
# to a particular REPL, and to get the current Application from the stack.
def patch_prompt_toolkit():
    default_get_app = prompt_toolkit.application.current.get_app

    def get_app_patched() -> Application[Any]:
        stack = inspect.stack()
        for frame in stack:
            self_var = frame.frame.f_locals.get("self")
            if self_var is not None and isinstance(self_var, Application):
                return self_var
        return default_get_app()

    prompt_toolkit.application.current.get_app = get_app_patched
    prompt_toolkit.key_binding.key_processor.get_app = get_app_patched
    ptpython.python_input.get_app = get_app_patched
    ptpython.key_bindings.get_app = get_app_patched
    ptpython.history_browser.get_app = get_app_patched
    ptpython.layout.get_app = get_app_patched
patch_prompt_toolkit()


def configure(repl: PythonRepl) -> None:
    repl.confirm_exit = False
    repl.enable_open_in_editor = False
    repl.enable_system_bindings = False


class AsyncStreamStdout:
    """
    Wrapper around StreamReader and StreamWriter to provide `write` and `flush`
    methods for Vt100_Output.
    """

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.loop = asyncio.get_event_loop()

    def write(self, data: bytes) -> None:
        if isinstance(data, str):
            data = data.encode()
        self.writer.write(data)

    def flush(self) -> None:
        self.loop.create_task(self.writer.drain())

    def isatty(self) -> bool:
        return True


# keep a reference to the server alive so it doesn't get garbage collected
repl_server = None


async def createREPLServer(sdk: ScryptedStatic, plugin: ScryptedDevice) -> int:
    global repl_server

    if repl_server is not None:
        return repl_server["port"]

    deviceManager = sdk.deviceManager
    systemManager = sdk.systemManager
    mediaManager = sdk.mediaManager

    async def on_repl_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        filter = await reader.read(1024)
        filter = filter.decode()
        if filter == "undefined":
            filter = None

        chain: List[str] = []
        nativeIds: Dict[str, Any] = deviceManager.nativeIds
        reversed: Dict[str, str] = {v.id: k for k, v in nativeIds.items()}

        while filter is not None:
            id = nativeIds.get(filter).id
            d = systemManager.getDeviceById(id)
            chain.append(filter)
            filter = reversed.get(d.providerId)

        chain.reverse()
        device = plugin
        for c in chain:
            device = await maybe_await(device.getDevice(c))
        realDevice = systemManager.getDeviceById(device.id)

        with create_pipe_input() as vt100_input:
            vt100_output = Vt100_Output(
                AsyncStreamStdout(reader, writer),
                lambda: Size(rows=24, columns=80),
                term=None,
            )

            async def vt100_input_coro():
                while True:
                    data = await reader.read(1024)
                    if not data:
                        break
                    vt100_input.send_bytes(data)

            asyncio.create_task(vt100_input_coro())

            with create_app_session(input=vt100_input, output=vt100_output):
                global_dict = {
                    **base_globals.copy(),
                    "print": print_formatted_text,
                    "help": lambda *args, **kwargs: print_formatted_text(
                        "Help is not available in this environment"
                    ),
                    "input": lambda *args, **kwargs: print_formatted_text(
                        "Input is not available in this environment"
                    ),
                }
                locals_dict = {
                    "device": device,
                    "systemManager": systemManager,
                    "deviceManager": deviceManager,
                    "mediaManager": mediaManager,
                    "sdk": sdk,
                    "realDevice": realDevice,
                }
                vars_prompt = "\n".join([f"  {k}" for k in locals_dict.keys()])
                banner = f"Python REPL variables:\n{vars_prompt}"
                print_formatted_text(banner)
                await embed(
                    return_asyncio_coroutine=True,
                    globals=global_dict,
                    locals=locals_dict,
                    configure=configure,
                )

    repl_server = await cluster_listen_zero(on_repl_client)
    return repl_server["port"]