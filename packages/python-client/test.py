from __future__ import annotations

import asyncio
import os

from scrypted_client import connect_scrypted_client
from scrypted_python.scrypted_sdk import ScryptedInterface


async def main(loop: asyncio.AbstractEventLoop):
    transport, sdk = await connect_scrypted_client(
        loop,
        os.environ.get("SCRYPTED_BASE_URL", "https://localhost:10443"),
        os.environ["SCRYPTED_USERNAME"],
        os.environ["SCRYPTED_PASSWORD"],
    )

    for id in sdk.systemManager.getSystemState():
        device = sdk.systemManager.getDeviceById(id)
        print(device.name)
        if ScryptedInterface.OnOff.value in device.interfaces:
            print(f"OnOff: device is {device.on}")

    await transport.close()


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(main(loop))
    finally:
        loop.close()
