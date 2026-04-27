# Kasa Camera Plugin

Adds support for TP-Link Kasa cameras to Scrypted. The plugin:

- Reads the camera's proprietary multipart stream (HTTPS port 19443, `/https/stream/mixed`)
  and re-streams H.264 video + G.711 µ-law audio over local RTSP for Scrypted, HomeKit, the
  NVR, etc.
- Streams talk audio back to the camera's speaker via the camera's separate uplink endpoint
  (HTTPS port 18443, `/https/speaker/audio/g711block`) — usable from HomeKit and any other
  Scrypted client that supports two-way audio.

Stream side ported from [go2rtc's `pkg/kasa`](https://github.com/AlexxIT/go2rtc/tree/master/pkg/kasa);
talk side reverse-engineered from the official Kasa iOS app traffic.

Tested models: KD110, KC200, KC401, KC420WS, EC71.

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

### Receive (camera → Scrypted)

- The plugin opens a single HTTPS connection to the camera on port 19443 and parses the
  `multipart/x-mixed-replace` body, splitting it into video parts (`video/x-h264`,
  annex-b) and audio parts (`audio/g711u`).
- It scans the first H.264 frames for SPS (NAL 7) and PPS (NAL 8) and inlines them into
  the locally served SDP as `sprop-parameter-sets` + `profile-level-id`. This lets short
  -timeout consumers (HomeKit, browser players) pick up the codec immediately.
- It then runs ffmpeg in codec-copy mode, re-packetizing the raw H.264 and G.711 µ-law
  streams as RTP into a local RTSP server that Scrypted reads from.

### Talk (Scrypted → camera speaker)

- When a client engages two-way audio, the plugin opens a long-lived chunked POST to
  `https://<ip>:18443/https/speaker/audio/g711block` and ffmpeg-transcodes the client's
  audio to 8 kHz mono G.711 µ-law.
- Each 20 ms (160 byte) audio block is wrapped in a `multipart/x-mixed-replace` part with
  `Content-Type: audio/g711u` and streamed to the camera. Empty `audio/heartbeat` parts
  are sent every 3 s during silence to keep the connection alive — same pattern the Kasa
  app uses.

## Notes / limitations

- **Authentication** uses the cloud account password. Both endpoints accept Basic auth
  with the plain Kasa email; the receive side wants the password as base64(plaintext)
  and the talk side wants md5_hex(plaintext) — the plugin uses each in the right place.
- The camera presents a self-signed TLS certificate; certificate verification is disabled.
- Auto-discovery sweeps the local /24 only. Larger subnets (e.g. /23) are skipped to
  avoid flooding.
