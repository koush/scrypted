# AGENTS.md — Scrypted Repository Guide

Scrypted is a high-performance home video integration platform and NVR with smart detections. It
streams low-latency video to HomeKit, Google Home, Alexa, and other ecosystems, and exposes a plugin
system for cameras, integrations, detections, and automations.

This repository contains the **Scrypted server**, the **plugin SDK**, **shared libraries**, and the
**official/core plugins**. All of these are published independently to npm (`@scrypted/*`) — the
server downloads and runs plugins from the npm registry at runtime, it does not bundle them.

- User docs / installation: https://docs.scrypted.app
- Plugin developer docs: https://developer.scrypted.app
- Community: Discord, Reddit, GitHub

## Repository map

| Path | Package(s) | Purpose |
| --- | --- | --- |
| `server/` | `@scrypted/server` | The runtime/host process. Loads plugins, provides RPC, HTTP/WebSocket/Engine.IO routing, storage, users, clustering, media plumbing, and plugin runtime isolation. |
| `sdk/` | `@scrypted/sdk`, `sdk/types` → `@scrypted/types` | Plugin build/deploy tooling (`scrypted-webpack`, `scrypted-deploy`, `scrypted-setup-project`, …) and the canonical type/interface definitions (TypeScript + Python). |
| `common/` | `@scrypted/common` (private) | Shared utilities used by plugins (`file:../common` dependency). Not published. |
| `plugins/` | `@scrypted/<name>` | Official plugins: core UI/automations, camera protocols, integrations, mixins, ML detectors, dev tools. Each is an independent npm package. |
| `packages/` | `@scrypted/client`, `@scrypted/rpc`, `scrypted` CLI, etc. | Shared npm libraries published separately from the server. |
| `install/` | — | Installers and deployment: Dockerfiles/compose, local OS dependency scripts (Linux/macOS/Windows), Home Assistant add-on config, Proxmox/LXC setup. |
| `external/` | — | Git submodules for forked dependencies: `werift` (WebRTC), `ring-client-api`, `unifi-protect`. |
| `sites/static/` | — | Static web content deployed to GitHub Pages (Google Cast receiver, Google Home local SDK app). |

### Other submodules

Some plugins live in submodules: `plugins/sample-cameraprovider`, `plugins/vscode-typescript`,
`plugins/cloud/external/node-nat-upnp`, `plugins/wyze/docker-wyze-bridge`. Run
`git submodule update --init --recursive` before working with them.

## Server (`server/`)

Plain TypeScript compiled with `tsc` to `dist/` (no bundler). Node **18+** is enforced at startup.

Key files:

- `src/scrypted-main.ts`, `src/scrypted-main-exports.ts` — process bootstrap (`bin/scrypted-serve`).
- `src/runtime.ts` — `ScryptedRuntime`: installs and runs plugins, routes HTTP/WebSocket/Engine.IO
  endpoints to the owning plugin, manages plugin hosts.
- `src/plugin/plugin-host.ts` — host-side lifecycle and RPC connection to a plugin process.
- `src/plugin/runtime/` — runtime worker implementations (node fork, worker thread, child process,
  Python worker, cluster fork, custom worker).
- `src/rpc.ts`, `src/rpc-serializer.ts`, `src/rpc-buffer-serializer.ts` — the RPC proxy/serialization
  layer used between server and plugins (and cluster nodes).
- `src/services/` — system services: plugin install/registry, users/auth, backup, cluster, alerts,
  addresses, env, info.
- `src/cluster/`, `src/scrypted-cluster-main.ts` — multi-node cluster mode.
- `src/plugin/descriptor.ts` — interface/property introspection from `@scrypted/types`.
- `src/plugin/media.ts`, `src/plugin/mediaobject.ts`, `src/media-helpers.ts` — media object model and
  media helpers.
- `bin/postinstall`, `bin/packaged-python.js` — installs a portable Python when
  `SCRYPTED_PYTHON_PATH` is unset.
- `test/` — standalone test scripts (RPC, iterators, threading, Python). There is no test runner
  configured; run them directly after building.

Runtime state lives in `SCRYPTED_VOLUME` (default `~/.scrypted/volume`), with installed plugins at
`<volume>/plugins/<pluginId>`. The NVR storage location is `SCRYPTED_NVR_VOLUME`.

## Plugin model (`plugins/`)

Each plugin is its own npm package whose `package.json` has a `scrypted` manifest field:

```json
"scrypted": {
  "name": "HomeKit",
  "type": "DeviceProvider",
  "interfaces": ["DeviceProvider", "Settings", "..."],
  "babel": true,     // optional: Babel transpile instead of type-checked build
  "realfs": true,    // optional: plugin needs a real filesystem (no zipfs)
  "runtime": "python" // optional: Python plugin
}
```

Common `type` values: `DeviceProvider` (adds devices), `API`/mixin-providing plugins, `Builtin`
(`@scrypted/core`), `DeviceCreator`, `Light`.

Plugins implement interfaces declared in `@scrypted/types` (`DeviceProvider`, `ScryptedDevice`,
`Camera`, `VideoCamera`, `OnOff`, `Brightness`, `ObjectDetector`, `Settings`, …). A plugin can also
provide mixins that inject extra interfaces into existing devices.

Core plugin groups:

- **Core**: `core` (UI/WebSocket/Engine.IO APIs, automations, scripts, users, terminal, cluster
  helpers). The web UI assets are not tracked in this checkout.
- **Camera/device protocols**: `rtsp`, `onvif`, `amcrest`, `hikvision`, `hikvision-doorbell`,
  `reolink`, `unifi-protect`, `ring`, `tapo`, `tuya`, `eufy`, `wyze`, `doorbird`, `bticino`,
  `synology-ss`, `ffmpeg-camera`, `gstreamer-camera`, `webrtc`, `python-codecs`.
- **Mixins**: `prebuffer-mixin`, `objectdetector`, `notifier-mixin`.
- **Detection/ML**: `opencv`, `onnx`, `openvino`, `coreml`, `rknn`, `ncnn`, `tensorflow-lite`.
- **Ecosystem integrations**: `homekit`, `alexa`, `google-home`, `google-device-access`,
  `chromecast`, `mqtt`, `smtp`, `webhook`, `sip`, `zwave`, `cloud`, `remote`.
- **Developer/debug**: `diagnostics`, `vscode-typescript`, `vscode-python`, `dummy-switch`,
  `snapshot`, `sample-cameraprovider`.

Plugins are versioned and published independently; the server installs them from npm at runtime.

## SDK and types (`sdk/`)

- `sdk/src/bin/` — CLI tools installed as bins: `scrypted-webpack` (build), `scrypted-deploy`
  (deploy to a running server), `scrypted-deploy-debug`, `scrypted-debug`, `scrypted-setup-project`,
  `scrypted-package-json`, `scrypted-changelog`.
- `sdk/types/src/types.input.ts` — **source of truth** for Scrypted interfaces/types. Editing this
  regenerates the SDK.
- `sdk/types/src/build.ts`, `sdk/types/gen/` — generated TypeScript types, interface descriptors,
  and `schema.json`.
- `sdk/types/scrypted_python/scrypted_sdk/` — generated Python SDK used by Python plugins.
- `sdk/tsconfig.plugin.json` — base config for plugin builds.

Plugin build output: a `plugin.zip` (webpack bundle for Node plugins, or `src/main.py` + bundled
`scrypted_sdk` for Python plugins). The zip is what gets deployed/installed into the server volume.

## Shared packages (`packages/`)

`@scrypted/client` (API client), the `scrypted` CLI (install/serve/shell/console/RTSP tools),
`@scrypted/rpc`, `@scrypted/auth-fetch`, `@scrypted/rtsp-server`, `@scrypted/h264-repacketizer`,
`@scrypted/h265-repacketizer`, `@scrypted/promise`, `@scrypted/deferred`,
`@scrypted/stream-promise`, `@scrypted/self-signed-certificate`, `@scrypted/python-client`.
Each is an independent npm project with its own build.

## Build and development

There is **no root package.json / npm workspace**. Each directory is its own project.

```sh
# First-time setup: init submodules; install sdk, server, common, packages/client, and
# packages/auth-fetch; build sdk; install external/werift; install a set of popular plugins.
./npm-install.sh
```

After the initial setup, plugin builds do not require any SDK rebuild step.

Server:

```sh
cd server
npm install
npm run build        # tsc --build; postbuild verifies expected output
npm run serve        # build then run (dist/scrypted-main.js)
npm run serve-no-build
```

SDK (only needed when working on the SDK itself — initial setup already built it):

```sh
cd sdk
npm install
npm run build        # builds sdk/types first, then the SDK
```

Plugin:

```sh
cd plugins/homekit
npm install
npm run build                  # scrypted-webpack -> out/ or dist/
npm run scrypted-deploy 127.0.0.1
```

Deploying a plugin hot-reloads it on the running server; restarting the server is not required for
plugin changes. VS Code launch configs (`plugins/*/.vscode`) build and deploy-debug the plugin.

Changing types/interfaces: edit `sdk/types/src/types.input.ts`, then `cd sdk && npm run build` to
regenerate TypeScript, interface descriptors, schema, and Python types. This is only required when
the SDK itself changes — routine plugin work does not need an SDK rebuild.

Some plugins have build-time cross-dependencies or requirements:

- `plugins/homekit` imports code from `plugins/webrtc`.
- `plugins/core` imports from a sibling `manage.scrypted.app` repository (`../manage.scrypted.app`),
  which is not part of this checkout; CI assumes `plugins/core/ui` exists for UI builds.
- Python plugins require the Python SDK/runtime; native/ML plugins have platform-specific wheels.
- Docker images come in variants (`lite`, `full`, `nvidia`, etc.) reflecting bundled dependencies.

## CI and releases (`.github/workflows/`)

- `build-sdk.yml` — builds `sdk/` on changes to `sdk/**`.
- `test.yml` — installs and starts the server on Linux/macOS/Windows via `scryptedapp/setup-scrypted`;
  only runs on `install/**` changes.
- `build-plugins-changed.yml` — **manual** (`workflow_dispatch`); builds changed plugins from the
  last commit.
- `docker*.yml` — build/publish `ghcr.io/koush/scrypted` images.
- `python-sdk.yml` — publishes the Python SDK.
- `static-sites.yml` — deploys `sites/static` to GitHub Pages.
- `release.yml` — creates a GitHub release for `v*` tags.

There is no repo-wide lint/unit-test job. `server/test/` contains ad-hoc tests; run them directly.

## Conventions and gotchas

- Do not run `npm install` at the repo root; it has no package.json. Use `./npm-install.sh` or
  install per package.
- The `sdk` is built once during repo initialization by `./npm-install.sh`. Do not rebuild it as
  part of routine plugin development; rebuild only when changing SDK sources or `sdk/types`.
- Plugin changes are delivered by build + deploy (or npm publish); the server repo does not contain
  plugin runtime code. Version bumps in plugin `package.json` are meaningful for releases.
- Node.js 18 or newer is required to run the server (CI uses 18 and 22).
- The core plugin is also the server's HTTP/WebSocket/Engine.IO API surface; changes there affect
  every client, not just the UI.
- `SCRYPTED_VOLUME`, `SCRYPTED_NVR_VOLUME`, `SCRYPTED_PYTHON_PATH`, and
  `SCRYPTED_CLUSTER_*` environment variables are the main runtime knobs (see
  `server/src/plugin/plugin-volume.ts` and `server/src/services/env.ts`).
