# python-client

Connect to a Scrypted server from Python and use the same SDK objects
(`systemManager`, `deviceManager`, `mediaManager`) that Python plugins see.

The modules in this directory are symlinks into `../../server/python` and
`../../sdk/types` so the client and the plugin runtime share one
implementation.

## Usage

```bash
pip install -r requirements.txt
```

```python
import asyncio

from scrypted_client import connect_scrypted_client


async def main(loop):
    transport, sdk = await connect_scrypted_client(
        loop, "https://localhost:10443", "username", "password"
    )
    for id in sdk.systemManager.getSystemState():
        print(sdk.systemManager.getDeviceById(id).name)
    await transport.close()


loop = asyncio.new_event_loop()
loop.run_until_complete(main(loop))
```

`test.py` is a runnable version of the above; point it at a server with the
`SCRYPTED_BASE_URL`, `SCRYPTED_USERNAME`, and `SCRYPTED_PASSWORD` environment
variables.

By default the login request and the engine.io connection skip TLS
certificate verification, since Scrypted servers use self-signed certificates
out of the box. To control TLS (or connection pooling), pass your own
`login_session` and a pre-built `EioRpcTransport(loop, http_session=...)`.
