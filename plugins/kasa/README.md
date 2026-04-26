# Kasa Camera Plugin

Adds support for TP-Link Kasa cameras to Scrypted. The plugin connects to the camera's
proprietary multipart streaming endpoint (HTTPS port 19443, `/https/stream/mixed`) and
re-streams the H.264 video + G.711 µ-law audio locally over RTSP for Scrypted, HomeKit,
the NVR, etc.

Ported from [go2rtc's `pkg/kasa`](https://github.com/AlexxIT/go2rtc/tree/master/pkg/kasa).
Tested models (per go2rtc): KD110, KC200, KC401, KC420WS, EC71.

## Setup

### Auto-discovery (recommended)

1. Install the plugin.
2. Open the plugin's page and click **Discover Devices**. Discovery runs only when you
   click the button — there are no background scans.
3. Each LAN-visible Kasa camera appears in the list.
4. For each camera you want to adopt, fill in the adoption form and click adopt:
   - **Name** — pre-filled with the camera's alias or model; edit to taste.
   - **Room** — optional, picked from a dropdown of rooms already in use by other
     Scrypted devices, or type a new one.
   - **Username** / **Password** — your Kasa account email and password. After the first
     camera is configured these fields are pre-populated from any existing Kasa camera
     in Scrypted, so usually just click adopt for additional cameras.

Adopted cameras get their IP, port, name, model, MAC, serial number, and firmware version
populated automatically. The manufacturer is reported as `TP-Link Kasa` to match the Kasa
Smart plugin's labeling.

Discovery uses three probes in sequence:

- A **UDP/9999 broadcast** of the IOT.SMARTHOME `get_sysinfo` query. Older Kasa devices
  (mostly plugs and some camera firmwares) respond this way with full metadata. Smart
  plugs/bulbs that come back are filtered out by `type`.
- A **TCP/19443 sweep** of the local /24. Cameras whose firmware ignores LAN broadcasts
  still listen on the streaming port; any host that completes a TLS handshake on 19443
  is treated as a Kasa-camera candidate.
- A **unicast UDP/9999 probe** sent directly at each TCP candidate. Newer camera
  firmwares (e.g. KC420WS) drop broadcast probes but still answer the same query when
  it's directed at them. This recovers their alias and model so the discovery list shows
  real names instead of a generic "Kasa Camera".

If your camera is on a different VLAN/broadcast domain or a non-/24 subnet, use the
manual setup below.

### Manual setup

1. Install the plugin.
2. Use **Add Camera** to create a new camera. The Add form takes:
   - **Name** — required.
   - **Room** — optional, with the same dropdown of existing rooms as the discovery flow.
3. After creation, open the camera's settings and fill in:
   - **IP Address** of the camera on your LAN
   - **Port** (default 19443)
   - **Username** — your TP-Link/Kasa account email
   - **Password** — your TP-Link/Kasa account password

## How it works

- On the first request for a stream, the plugin opens a single HTTPS connection to the
  camera and parses the multipart `multipart/x-mixed-replace` body, splitting it into
  video parts (`video/x-h264`, annex-b) and audio parts (`audio/g711u`).
- It scans the first H.264 frames for SPS (NAL 7) and PPS (NAL 8) and inlines them into
  the locally served SDP as `sprop-parameter-sets` + `profile-level-id`. This lets short
  -timeout consumers (HomeKit, browser players) pick up the codec immediately.
- It then runs ffmpeg in codec-copy mode, re-packetizing the raw H.264 and G.711 µ-law
  streams as RTP into a local RTSP server that Scrypted reads from.

## Notes / limitations

- **Authentication** uses the cloud account password directly: username is the plain
  Kasa email; password is base64-encoded as Basic auth (a camera-specific quirk).
- The camera presents a self-signed TLS certificate; certificate verification is disabled.
- Auto-discovery sweeps the local /24 only. Larger subnets (e.g. /23) are skipped to
  avoid flooding.
