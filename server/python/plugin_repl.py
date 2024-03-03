import ast
import asyncio
from asyncio import futures
import code
import concurrent
import inspect
import os
import platform
import pty
import signal
import socket
import sys
import threading
import traceback
import types
from typing import List, Dict, Any

from scrypted_python.scrypted_sdk import ScryptedStatic, ScryptedDevice

from rpc import maybe_await
import connect_to_repl

def is_pid_alive(pid):
    if platform.system() == 'Windows':
        # On Windows, use os.kill with signal 0 to check if the process exists
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(1, 0, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        else:
            return False
    else:
        # On Unix-like systems, use os.kill with signal 0 to check if the process exists
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        else:
            return True


# This section is a bit of a hack - the REPL's eval capabilities triggers
# sys.displayhook to print the result of the eval. We want to capture the
# result and send it to the correct Scrypted REPL connection instead of printing
# it to the default Scrypted server console.
REPL_WRITER_KEY = "__scrypted_repl_writer__"
default_displayhook = sys.displayhook
def repl_displayhook(value):
    stack = inspect.stack()
    writer = None
    for f in stack:
        if REPL_WRITER_KEY in f.frame.f_locals:
            writer = f.frame.f_locals[REPL_WRITER_KEY]
            break

    if not writer:
        default_displayhook(value)
        return

    writer.write(repr(value) + "\n")
    writer.flush()
sys.displayhook = repl_displayhook


class REPL(code.InteractiveConsole):
    # based on AsyncIOInteractiveConsole and InteractiveConsole from Python source code

    def __init__(self, locals, loop, reader, writer):
        super().__init__(locals)
        self.compile.compiler.flags |= ast.PyCF_ALLOW_TOP_LEVEL_AWAIT

        self.loop = loop
        self.reader = reader
        self.writer = writer

    def runcode(self, code):
        future = concurrent.futures.Future()

        def callback():
            self.repl_future = None
            self.repl_future_interrupted = False

            func = types.FunctionType(code, self.locals)
            try:
                coro = func()
            except SystemExit:
                raise
            except KeyboardInterrupt as ex:
                self.repl_future_interrupted = True
                future.set_exception(ex)
                return
            except BaseException as ex:
                future.set_exception(ex)
                return

            if not inspect.iscoroutine(coro):
                future.set_result(coro)
                return

            try:
                self.repl_future = self.loop.create_task(coro)
                futures._chain_future(self.repl_future, future)
            except BaseException as exc:
                future.set_exception(exc)

        self.loop.call_soon_threadsafe(callback)

        try:
            result = future.result()
            return result
        except SystemExit:
            raise
        except BaseException:
            if self.repl_future_interrupted:
                self.write("\nKeyboardInterrupt\n")
            else:
                self.showtraceback()

    def showsyntaxerror(self, filename=None):
        type, value, tb = sys.exc_info()
        sys.last_type = type
        sys.last_value = value
        sys.last_traceback = tb
        if filename and type is SyntaxError:
            # Work hard to stuff the correct filename in the exception
            try:
                msg, (dummy_filename, lineno, offset, line) = value.args
            except ValueError:
                # Not the format we expect; leave it alone
                pass
            else:
                # Stuff in the right filename
                value = SyntaxError(msg, (filename, lineno, offset, line))
                sys.last_value = value
        lines = traceback.format_exception_only(type, value)
        self.write(''.join(lines))

    def showtraceback(self) -> types.NoneType:
        sys.last_type, sys.last_value, last_tb = ei = sys.exc_info()
        sys.last_traceback = last_tb
        try:
            lines = traceback.format_exception(ei[0], ei[1], last_tb.tb_next)
            self.write(''.join(lines))
        finally:
            last_tb = ei = None

    def raw_input(self, prompt: str = "") -> str:
        self.write(prompt)
        while not self.reader.closed:
            try:
                return self.reader.readline()
            except:
                pass

    def write(self, data: str) -> None:
        self.writer.write(data)
        self.writer.flush()


async def createREPLServer(sdk: ScryptedStatic, plugin: ScryptedDevice) -> int:
    deviceManager = sdk.deviceManager
    systemManager = sdk.systemManager
    mediaManager = sdk.mediaManager

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        filter = await reader.read(4096)
        filter = filter.decode("utf-8").strip()
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

        loop = asyncio.get_event_loop()

        # start tcp server
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('localhost', 0))
        sock.listen()
        sock.settimeout(None)

        def repl_thread():
            conn, addr = sock.accept()
            conn_reader = conn.makefile("r")
            conn_writer = conn.makefile("w")

            builtins = {}
            builtins.update(__builtins__)

            # redirect print to our repl connection
            builtins["print"] = lambda *args, **kwargs: print(*args, **kwargs, file=conn_writer)

            # these builtins cause problems with the repl
            del builtins["input"]
            del builtins["help"]
            del builtins["license"]

            locals = {
                "device": device,
                "realDevice": realDevice,
                "sdk": sdk,
                "mediaManager": mediaManager,
                "systemManager": systemManager,
                "deviceManager": deviceManager,
            }

            vars_prompt = '\n'.join([f"  {k}" for k in locals.keys()])
            banner = f"Python REPL variables:\n{vars_prompt}"
            console = REPL(
                locals={
                    **locals,
                    REPL_WRITER_KEY: conn_writer,
                    "__builtins__": builtins,
                },
                loop=loop,
                reader=conn_reader,
                writer=conn_writer,
            )
            console.interact(banner=banner)
            conn.close()
        t = threading.Thread(target=repl_thread, daemon=True)
        t.start()

        addr = sock.getsockname()
        port = addr[1]

        # fork a pty and subprocess to connect to the repl
        pid, fd = pty.fork()
        if pid == 0:
            # child
            os.execv(sys.executable, [sys.executable, connect_to_repl.__file__, "localhost", str(port)])

        # read from p in separate thread
        q = asyncio.Queue()
        def reader_thread():
            while is_pid_alive(pid):
                try:
                    data = os.read(fd, 4096)
                    loop.call_soon_threadsafe(q.put_nowait, data)
                except:
                    pass
            loop.call_soon_threadsafe(q.put_nowait, None)
        t = threading.Thread(target=reader_thread, daemon=True)
        t.start()

        async def forward():
            while True:
                data = await reader.read(4096)
                if not data:
                    break
                os.write(fd, data)
        async def backward():
            while True:
                data = await q.get()
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        await asyncio.gather(forward(), backward())
        os.kill(pid, signal.SIGKILL)

    server = await asyncio.start_server(handler, 'localhost', 0)
    addr = server.sockets[0].getsockname()
    port = addr[1]
    return port