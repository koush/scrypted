import asyncio
import concurrent.futures
from functools import partial
import inspect
import os
import prompt_toolkit
from prompt_toolkit import print_formatted_text
from prompt_toolkit.application import Application
import prompt_toolkit.application.current
import prompt_toolkit.key_binding.key_processor
import prompt_toolkit.contrib.telnet.server
from prompt_toolkit.contrib.telnet.server import TelnetServer, TelnetConnection
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.shortcuts import clear_title, set_title
from ptpython.repl import embed, PythonRepl, _has_coroutine_flag
import ptpython.key_bindings
import ptpython.python_input
import ptpython.history_browser
import ptpython.layout
import socket
import sys
import telnetlib
import threading
import traceback
import types
from typing import List, Dict, Any

from scrypted_python.scrypted_sdk import ScryptedStatic, ScryptedDevice

from rpc import maybe_await


# Our client is xtermjs, so no need to perform any color depth detection
ColorDepth.default = lambda *args, **kwargs: ColorDepth.DEPTH_4_BIT


# This section is a bit of a hack - prompt_toolkit has many assumptions
# that there is only one global Application, so multiple REPLs will confuse
# the library. The patches here allow us to scope a particular call stack
# to a particular REPL, and to get the current Application from the stack.
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
prompt_toolkit.contrib.telnet.server.get_app = get_app_patched
ptpython.python_input.get_app = get_app_patched
ptpython.key_bindings.get_app = get_app_patched
ptpython.history_browser.get_app = get_app_patched
ptpython.layout.get_app = get_app_patched


# This is a patched version of PythonRepl.run_async to handle an
# AssertionError raised by prompt_toolkit when the TelnetServer exits.
# Original: https://github.com/prompt-toolkit/ptpython/blob/3.0.26/ptpython/repl.py#L215
async def run_async_patched(self: PythonRepl) -> None:
    """
    Run the REPL loop, but run the blocking parts in an executor, so that
    we don't block the event loop. Both the input and output (which can
    display a pager) will run in a separate thread with their own event
    loop, this way ptpython's own event loop won't interfere with the
    asyncio event loop from where this is called.

    The "eval" however happens in the current thread, which is important.
    (Both for control-C to work, as well as for the code to see the right
    thread in which it was embedded).
    """
    loop = asyncio.get_running_loop()

    if self.terminal_title:
        set_title(self.terminal_title)

    self._add_to_namespace()

    try:
        while True:
            try:
                # Read.
                try:
                    text = await loop.run_in_executor(None, self.read)
                except EOFError:
                    return
                except asyncio.CancelledError:
                    return
                except AssertionError:
                    return
                except BaseException:
                    # Something went wrong while reading input.
                    # (E.g., a bug in the completer that propagates. Don't
                    # crash the REPL.)
                    traceback.print_exc()
                    continue

                # Eval.
                await self.run_and_show_expression_async(text)

            except KeyboardInterrupt as e:
                # XXX: This does not yet work properly. In some situations,
                # `KeyboardInterrupt` exceptions can end up in the event
                # loop selector.
                self._handle_keyboard_interrupt(e)
            except SystemExit:
                return
    finally:
        if self.terminal_title:
            clear_title()
        self._remove_from_namespace()


# This is a patched version of PythonRepl.eval_async to cross thread
# boundaries when running user REPL instructions.
# Original: https://github.com/prompt-toolkit/ptpython/blob/3.0.26/ptpython/repl.py#L304
async def eval_async_patched(self: PythonRepl, line: str) -> object:
    """
    Evaluate the line and print the result.
    """
    scrypted_loop: asyncio.AbstractEventLoop = self.scrypted_loop

    def task_done_cb(future: concurrent.futures.Future, task: asyncio.Task):
        try:
            result = task.result()
            future.set_result(result)
        except BaseException as e:
            future.set_exception(e)

    def eval_in_scrypted(future: concurrent.futures.Future, code, *args, **kwargs):
        try:
            result = eval(code, *args, **kwargs)
            if _has_coroutine_flag(code):
                task = scrypted_loop.create_task(result)
                task.add_done_callback(partial(task_done_cb, future))
            else:
                future.set_result(result)
        except BaseException as e:
            future.set_exception(e)

    def eval_across_loops(code, *args, **kwargs):
        future = concurrent.futures.Future()
        scrypted_loop.call_soon_threadsafe(
            partial(eval_in_scrypted, future), code, *args, **kwargs
        )
        return future.result()

    # WORKAROUND: Due to a bug in Jedi, the current directory is removed
    # from sys.path. See: https://github.com/davidhalter/jedi/issues/1148
    if "" not in sys.path:
        sys.path.insert(0, "")

    if line.lstrip().startswith("!"):
        # Run as shell command
        os.system(line[1:])
    else:
        # Try eval first
        try:
            code = self._compile_with_flags(line, "eval")
        except SyntaxError:
            pass
        else:
            # No syntax errors for eval. Do eval.

            result = eval_across_loops(code, self.get_globals(), self.get_locals())
            self._store_eval_result(result)
            return result

        # If not a valid `eval` expression, compile as `exec` expression
        # but still run with eval to get an awaitable in case of a
        # awaitable expression.
        code = self._compile_with_flags(line, "exec")
        result = eval_across_loops(code, self.get_globals(), self.get_locals())

    return None


def configure(scrypted_loop: asyncio.AbstractEventLoop, repl: PythonRepl) -> None:
    repl.confirm_exit = False
    repl.enable_system_bindings = False
    repl.enable_mouse_support = False
    repl.run_async = types.MethodType(run_async_patched, repl)
    repl.eval_async = types.MethodType(eval_async_patched, repl)
    repl.scrypted_loop = scrypted_loop


async def createREPLServer(sdk: ScryptedStatic, plugin: ScryptedDevice) -> int:
    deviceManager = sdk.deviceManager
    systemManager = sdk.systemManager
    mediaManager = sdk.mediaManager

    # Create the proxy server to handle initial control messages
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(None)
    sock.bind(("0.0.0.0" if os.getenv("SCRYPTED_CLUSTER_ADDRESS") else "127.0.0.1", 0))
    sock.listen()

    scrypted_loop: asyncio.AbstractEventLoop = asyncio.get_event_loop()

    async def start_telnet_repl(future: concurrent.futures.Future, filter: str) -> None:
        repl_loop = asyncio.get_event_loop()

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

        # Select a free port for the telnet server
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("localhost", 0))
        telnet_port = s.getsockname()[1]
        s.close()

        async def interact(connection: TelnetConnection) -> None:
            # repl_loop owns the print capabilities, but the prints will
            # be executed in scrypted_loop. We need to bridge the two here
            repl_print = partial(print_formatted_text, output=connection.vt100_output)

            def print_across_loops(*args, **kwargs):
                repl_loop.call_soon_threadsafe(repl_print, *args, **kwargs)

            global_dict = {
                **globals(),
                "print": print_across_loops,
                "help": lambda *args, **kwargs: print_across_loops(
                    "Help is not available in this environment"
                ),
                "input": lambda *args, **kwargs: print_across_loops(
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
                configure=partial(configure, scrypted_loop),
            )

        server_task: asyncio.Task = None

        def ready_cb():
            future.set_result(
                (
                    telnet_port,
                    lambda: repl_loop.call_soon_threadsafe(server_task.cancel),
                )
            )

        # Start the REPL server
        telnet_server = TelnetServer(
            interact=interact, port=telnet_port, enable_cpr=False
        )
        server_task = asyncio.create_task(telnet_server.run(ready_cb=ready_cb))
        try:
            await server_task
        except:
            pass

    def handle_connection(conn: socket.socket):
        conn.settimeout(None)
        filter = conn.recv(1024).decode()
        server_started_future = concurrent.futures.Future()
        repl_loop = asyncio.SelectorEventLoop()

        # we're not in the main loop, so can't handle any signals anyways
        repl_loop.add_signal_handler = lambda sig, cb: None
        repl_loop.remove_signal_handler = lambda sig: True

        def finish_setup():
            telnet_port, exit_server = server_started_future.result()

            telnet_client = telnetlib.Telnet("localhost", telnet_port, timeout=None)

            def telnet_negotiation_cb(telnet_socket, command, option):
                pass  # ignore telnet negotiation

            telnet_client.set_option_negotiation_callback(telnet_negotiation_cb)

            # initialize telnet terminal
            # this tells the telnet server we are a vt100 terminal
            telnet_client.get_socket().sendall(
                b"\xff\xfb\x18\xff\xfa\x18\x00\x61\x6e\x73\x69\xff\xf0"
            )
            telnet_client.get_socket().sendall(b"\r\n")

            # Bridge the connection to the telnet server, two way
            def forward_to_telnet():
                while True:
                    data = conn.recv(1024)
                    if not data:
                        break
                    telnet_client.write(data)
                telnet_client.close()
                exit_server()

            def forward_to_socket():
                prompt_count = 0
                while True:
                    data = telnet_client.read_some()
                    if not data:
                        conn.sendall("REPL exited".encode())
                        break
                    if b">>>" in data:
                        # This is an ugly hack - somewhere in ptpython, the
                        # initial prompt is being printed many times. Normal
                        # telnet clients handle it properly, but xtermjs doesn't
                        # like it. We just replace the first few with spaces
                        # so it's not too ugly.
                        prompt_count += 1
                        if prompt_count < 5:
                            data = data.replace(b">>>", b"   ")
                    conn.sendall(data)
                conn.close()
                exit_server()

            threading.Thread(target=forward_to_telnet).start()
            threading.Thread(target=forward_to_socket).start()

        threading.Thread(target=finish_setup).start()

        repl_loop.run_until_complete(start_telnet_repl(server_started_future, filter))

    def accept_connection():
        while True:
            conn, addr = sock.accept()
            threading.Thread(target=handle_connection, args=(conn,)).start()

    threading.Thread(target=accept_connection).start()

    proxy_port = sock.getsockname()[1]
    return proxy_port
