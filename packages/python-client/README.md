# python-client

Connect to a Scrypted server from Python and use the same SDK objects
(`systemManager`, `deviceManager`, `mediaManager`) that Python plugins see.

The modules in this directory are symlinks into `../../server/python` and
`../../sdk/types` so the client and the plugin runtime share one
implementation.

## Usage

Installed from PyPI, everything lives under the `scrypted_sdk` package:

```bash
pip install scrypted-sdk
```

```python
from scrypted_sdk import connect_scrypted_client
```

From a checkout of this repository, the modules are importable directly:

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

Session ownership: a `login_session` you pass is only borrowed for the login
request and is never closed. An `http_session` passed to `EioRpcTransport`
becomes owned by the transport — `transport.close()` closes it along with the
engine.io connection and background tasks — so don't share that session with
anything else.

## Packaging

The [scrypted-sdk](https://pypi.org/project/scrypted-sdk/) PyPI package is
built from this directory. Because the modules here are flat top-level
modules (that is how the plugin runtime loads them), publishing them as-is
would install modules named `rpc`, `plugin_remote`, etc. into consumers'
environments. Instead, a build hook ([hatch_build.py](hatch_build.py))
generates a `scrypted_sdk` package at build time: it copies each module
(reading through the symlinks) and mechanically rewrites the flat imports to
package-qualified ones (`import rpc` → `from scrypted_sdk import rpc`).
Nothing is committed and no runtime code is modified beyond that rewrite.

To build locally:

```bash
pip install build && python -m build   # or: uv build
```

To release: bump `version` in [pyproject.toml](pyproject.toml) and push a
`python-sdk-v*` tag. The [Python SDK workflow](../../.github/workflows/python-sdk.yml)
builds, smoke-tests, and publishes to PyPI via
[trusted publishing](https://docs.pypi.org/trusted-publishers/) — the PyPI
project just needs `koush/scrypted` + `python-sdk.yml` registered as a
trusted publisher (no API tokens).
