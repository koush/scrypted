"""Turn a light on and off from the command line.

The Python equivalent of packages/client/examples/light.ts.

Usage:

    pip install scrypted-sdk  # or, from a repo checkout: pip install packages/python-client
    SCRYPTED_USERNAME=admin SCRYPTED_PASSWORD=swordfish python light.py "Office Dimmer"

The server URL defaults to https://localhost:10443 and can be overridden
with SCRYPTED_BASE_URL.
"""

import asyncio
import os
import sys
from pathlib import Path

try:
    from scrypted_sdk import connect_scrypted_client
except ImportError:
    # running from a repo checkout without the scrypted-sdk package
    # installed: use the flat modules in the parent directory
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from scrypted_client import connect_scrypted_client


async def example(loop: asyncio.AbstractEventLoop):
    transport, sdk = await connect_scrypted_client(
        loop,
        os.environ.get("SCRYPTED_BASE_URL", "https://localhost:10443"),
        os.environ.get("SCRYPTED_USERNAME", "admin"),
        os.environ.get("SCRYPTED_PASSWORD", "swordfish"),
        plugin_id="@scrypted/core",
    )
    print("connected,", len(sdk.systemManager.getSystemState()), "devices")

    name = sys.argv[1] if len(sys.argv) > 1 else "Office Dimmer"
    dimmer = sdk.systemManager.getDeviceByName(name)
    if not dimmer:
        raise Exception("Device not found")
    await dimmer.turnOn()
    await asyncio.sleep(5)
    await dimmer.turnOff()
    # allow python to exit
    await transport.close()


loop = asyncio.new_event_loop()
loop.run_until_complete(example(loop))
