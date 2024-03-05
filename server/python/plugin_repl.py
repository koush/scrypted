import asyncio
import concurrent.futures
from prompt_toolkit import print_formatted_text
from prompt_toolkit.contrib.telnet.server import TelnetServer
from ptpython.repl import embed, PythonRepl
import socket
import telnetlib
import threading
from typing import List, Dict, Any

from scrypted_python.scrypted_sdk import ScryptedStatic, ScryptedDevice

from rpc import maybe_await


def configure(repl: PythonRepl) -> None:
    repl.confirm_exit = False
    repl.enable_system_bindings = False
    repl.enable_mouse_support = False


async def createREPLServer(sdk: ScryptedStatic, plugin: ScryptedDevice) -> int:
    deviceManager = sdk.deviceManager
    systemManager = sdk.systemManager
    mediaManager = sdk.mediaManager

    # Create the proxy server to handle initial control messages
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(None)
    sock.bind(('localhost', 0))
    sock.listen(1)

    async def start_telnet_repl(future, filter) -> None:
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
        s.bind(('localhost', 0))
        telnet_port = s.getsockname()[1]
        s.close()

        async def interact(connection) -> None:
            global_dict = {
                **globals(),
                "print": print_formatted_text,
                "help": lambda *args, **kwargs: print_formatted_text("Help is not available in this environment"),
            }
            locals_dict = {
                "device": device,
                "systemManager": systemManager,
                "deviceManager": deviceManager,
                "mediaManager": mediaManager,
                "sdk": sdk,
                "realDevice": realDevice
            }
            vars_prompt = '\n'.join([f"  {k}" for k in locals_dict.keys()])
            banner = f"Python REPL variables:\n{vars_prompt}"
            print_formatted_text(banner)
            await embed(return_asyncio_coroutine=True, globals=global_dict, locals=locals_dict, configure=configure)

        # Start the REPL server
        telnet_server = TelnetServer(interact=interact, port=telnet_port, enable_cpr=False)
        telnet_server.start()

        future.set_result(telnet_port)

    loop = asyncio.get_event_loop()

    def handle_connection(conn):
        filter = conn.recv(1024).decode()

        future = concurrent.futures.Future()
        loop.call_soon_threadsafe(loop.create_task, start_telnet_repl(future, filter))
        telnet_port = future.result()

        telnet_client = telnetlib.Telnet('localhost', telnet_port, timeout=None)

        def telnet_negotiation_cb(telnet_socket, command, option):
            pass  # ignore telnet negotiation
        telnet_client.set_option_negotiation_callback(telnet_negotiation_cb)

        # initialize telnet terminal
        # this tells the telnet server we are a vt100 terminal
        telnet_client.get_socket().sendall(b'\xff\xfb\x18\xff\xfa\x18\x00\x61\x6e\x73\x69\xff\xf0')
        telnet_client.get_socket().sendall(b'\r\n')

        # Bridge the connection to the telnet server, two way
        def forward_to_telnet():
            while True:
                data = conn.recv(1024)
                if not data:
                    break
                telnet_client.write(data)
        def forward_to_socket():
            prompt_count = 0
            while True:
                data = telnet_client.read_some()
                if not data:
                    conn.sendall('REPL exited'.encode())
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

        threading.Thread(target=forward_to_telnet).start()
        threading.Thread(target=forward_to_socket).start()

    def accept_connection():
        while True:
            conn, addr = sock.accept()
            threading.Thread(target=handle_connection, args=(conn,)).start()

    threading.Thread(target=accept_connection).start()

    proxy_port = sock.getsockname()[1]
    return proxy_port