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


class ReplOutputWriter:
    def __init__(self, queue: asyncio.Queue):
        self.queue = queue

    def write(self, data: bytes) -> None:
        if isinstance(data, str):
            data = data.encode()
        data = bytes(data)
        if data:
            self.queue.put_nowait(data)

    def flush(self) -> None:
        pass

    def isatty(self) -> bool:
        return True


def _to_bytes(value) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, str):
        return value.encode()
    return bytes(value)


def createREPLStreamService(sdk: ScryptedStatic, plugin: ScryptedDevice):
    async def get_repl_stream_service(input):
        iterator = input.__aiter__()
        try:
            first = await iterator.__anext__()
        except StopAsyncIteration:
            async def empty():
                if False:
                    yield

            return empty()

        first_bytes = _to_bytes(first)
        remainder = None

        newline = first_bytes.find(b"\n")
        if newline != -1:
            remainder = first_bytes[newline + 1 :]
            filter_text = first_bytes[:newline].decode(errors="replace")
        else:
            filter_text = first_bytes.decode(errors="replace")

        filter_text = filter_text.strip()
        filter_id = None if filter_text in ("", "undefined") else filter_text

        deviceManager = sdk.deviceManager
        systemManager = sdk.systemManager
        mediaManager = sdk.mediaManager

        chain: List[str] = []
        nativeIds: Dict[str, Any] = deviceManager.nativeIds
        reversed: Dict[str, str] = {v.id: k for k, v in nativeIds.items()}

        while filter_id is not None:
            entry = nativeIds.get(filter_id)
            if not entry:
                break
            chain.append(filter_id)
            d = systemManager.getDeviceById(entry.id)
            if not d or not d.providerId:
                break
            filter_id = reversed.get(d.providerId)

        chain.reverse()
        device = plugin
        for c in chain:
            device = await maybe_await(device.getDevice(c))
        realDevice = systemManager.getDeviceById(device.id)

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

        async def output_generator():
            output_queue = asyncio.Queue()
            writer = ReplOutputWriter(output_queue)

            with create_pipe_input() as vt100_input:
                vt100_output = Vt100_Output(
                    writer,
                    lambda: Size(rows=24, columns=80),
                    term=None,
                )

                async def input_pump():
                    try:
                        if remainder:
                            vt100_input.send_bytes(remainder)
                        async for data in iterator:
                            data = _to_bytes(data)
                            if data:
                                vt100_input.send_bytes(data)
                    except Exception:
                        pass
                    finally:
                        try:
                            vt100_input.close()
                        except Exception:
                            pass
                        output_queue.put_nowait(None)

                with create_app_session(input=vt100_input, output=vt100_output):
                    async def run_embed():
                        try:
                            print_formatted_text(banner)
                            await embed(
                                return_asyncio_coroutine=True,
                                globals=global_dict,
                                locals=locals_dict,
                                configure=configure,
                            )
                        finally:
                            output_queue.put_nowait(None)

                    embed_task = asyncio.create_task(run_embed())
                    input_task = asyncio.create_task(input_pump())

                    try:
                        while True:
                            item = await output_queue.get()
                            if item is None:
                                break

                            parts = [item]
                            done = False
                            while True:
                                try:
                                    next_item = output_queue.get_nowait()
                                except asyncio.QueueEmpty:
                                    break
                                if next_item is None:
                                    done = True
                                    break
                                parts.append(next_item)

                            if parts:
                                yield b"".join(parts)
                            if done:
                                break
                    finally:
                        input_task.cancel()
                        try:
                            vt100_input.close()
                        except Exception:
                            pass
                        await asyncio.wait([embed_task], timeout=5)
                        if not embed_task.done():
                            embed_task.cancel()
                        await asyncio.gather(
                            input_task, embed_task, return_exceptions=True
                        )
                        aclose = getattr(iterator, "aclose", None)
                        if aclose:
                            try:
                                await aclose()
                            except Exception:
                                pass

        return output_generator()

    return get_repl_stream_service
