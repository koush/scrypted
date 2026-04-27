# Kasa Plugin

Adds support for the TP-Link Kasa device family to Scrypted: cameras, plugs/outlets,
switches/dimmers, and bulbs. Discovery is unified — one UDP/9999 sweep finds everything
and the plugin routes each device to the right Scrypted interfaces.

## Cameras

- Reads the camera's proprietary multipart stream (HTTPS port 19443, `/https/stream/mixed`)
  and re-streams H.264 video + G.711 µ-law audio over local RTSP for Scrypted, HomeKit, the
  NVR, etc.
- Streams talk audio back to the camera's speaker via the camera's separate uplink endpoint
  (HTTPS port 18443, `/https/speaker/audio/g711block`) — usable from HomeKit and any other
  Scrypted client that supports two-way audio.
- Exposes the camera's spotlight (when present, e.g. KC420WS) as an `OnOff` child light
  device in the same room as the camera. Driven by the LINKIE2 control protocol on port
  10443.
- Exposes the camera's siren (when present) as an `OnOff` child switch device, also in
  the camera's room. Triggering it turns the siren on; the camera auto-stops after the
  duration configured in the Kasa app (default 30 s).
- Exposes the camera's **status LED** as the camera's own `OnOff` interface, so HomeKit's
  per-camera "Link Status Indicator" toggle drives the LED.

## Plugs / Switches / Dimmers / Bulbs (legacy IOT protocol)

Each device class is its own implementation, descended from a shared `KasaIotDevice`
base that holds the relay protocol:

- **`KasaPlug`** — plain plugs/outlets (HS100/HS103/HS105/HS107/HS110/KP100/...). `OnOff`,
  `ScryptedDeviceType.Outlet`.
- **`KasaSwitch`** — plain wall switches (HS200/HS210/KS200/...). `OnOff`,
  `ScryptedDeviceType.Switch`.
- **`KasaDimmer`** — dimmer plugs and switches (HS220 plug, KS230 3-way switch). `OnOff` +
  `Brightness`, `ScryptedDeviceType.Light` (dimmable devices are exposed as lights since
  they're almost always wired to a light fixture, matching the Kasa app's UX).
- **`KasaBulb`** — smart bulbs (LB1xx, KL1xx). `OnOff` + `Brightness`, plus
  `ColorSettingHsv` for color bulbs and `ColorSettingTemperature` for variable-temperature
  bulbs.

Multi-outlet plug strips (HS300, KP303) aren't modeled yet — discovery skips them.

Stream side ported from [go2rtc's `pkg/kasa`](https://github.com/AlexxIT/go2rtc/tree/master/pkg/kasa);
camera control sides reverse-engineered from the official Kasa iOS app traffic. The
plug/bulb/switch protocol is the well-documented legacy "smarthome" TCP/9999 wire format.

Tested camera models: KD110, KC200, KC401, KC420WS, EC71.

## Setup

### Auto-discovery (recommended)

1. Install the plugin.
2. Open the plugin's page and click **Discover Devices**. Discovery runs only when you
   click the button — there are no background scans.
3. Every LAN-visible Kasa device appears in the list — cameras, plugs, switches, dimmers,
   and bulbs are all discovered together.
4. For each device you want to adopt, fill in the adoption form and click adopt:
   - **Name** — pre-filled with the device's alias or model; edit to taste.
   - **Room** — optional, picked from a dropdown of rooms already in use by other
     Scrypted devices, or type a new one.
   - **Username** / **Password** *(cameras only)* — your Kasa account email and password.
     After the first camera is configured these are pre-populated from any other Kasa
     camera in Scrypted.

Adopted devices get their IP, port, name, model, MAC, serial number, and firmware version
populated automatically. The manufacturer is reported as `TP-Link Kasa`.

Discovery sends a single UDP/9999 burst on each connected /24:

- A **broadcast** of the IOT.SMARTHOME `get_sysinfo` query.
- A **paced unicast** of the same query at every IP on the subnet (~3 ms between sends).
  Newer firmwares (e.g. KC420WS cameras) drop broadcast probes but still answer when the
  packet is addressed directly. Pacing keeps the kernel/network from coalescing or
  dropping the burst.

If a device is on a different VLAN/broadcast domain or a non-/24 subnet, use the manual
setup below.

### Manual setup

1. Install the plugin.
2. Use **Add Device** to create a new device. The Add form takes:
   - **Type** — Camera, Plug, Switch, Dimmer, or Bulb.
   - **Name** — required.
   - **Room** — optional, with the same dropdown of existing rooms as the discovery flow.
3. After creation, open the device's settings and fill in:
   - **IP Address** of the device on your LAN
   - **Port** (default 19443 for cameras, 9999 for everything else)
   - For cameras: **Username** + **Password** (your Kasa account email + password)

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

### Spotlight / control plane

- The Kasa app talks to the camera's "LINKIE2" RPC on port 10443 for non-streaming
  features. Wire format: HTTPS POST `/data/LINKIE2.json`, body `application/x-www-form-
  urlencoded` with a single `content=<base64(xor_ab(json))>` field. The XOR-AB autokey
  cipher is the same one used by Kasa's UDP/9999 discovery protocol.
- On adoption (and whenever credentials change) the plugin probes three LINKIE2 endpoints
  serially:
  - `smartlife.cam.ipcamera.dayNight.get_force_lamp_state` — if it returns `on`/`off`, a
    child `OnOff` light device named "<camera> Spotlight" is registered in the camera's
    room.
  - `smartlife.cam.ipcamera.siren.get_state` — same pattern; produces a "<camera> Siren"
    switch child device.
  - `smartlife.cam.ipcamera.led.get_status` — drives the camera's own `OnOff` so HomeKit
    can bind its `CameraOperatingModeIndicator` (a.k.a. "Status Light") characteristic to
    it. Enable **Link Status Indicator** in the HomeKit plugin's per-camera settings to
    activate the binding.
- Toggling any of the three calls the matching `set_*` method with `{"value": "on"|"off"}`.

## Notes / limitations

- **Authentication** uses the cloud account password. All three endpoints take Basic auth
  with the plain Kasa email as the username; the password format differs by endpoint —
  receive uses base64(plaintext), talk and LINKIE2 use md5_hex(plaintext). The plugin
  uses each in the right place.
- LINKIE2 requests must include a `User-Agent: Kasa/...` header and the `Authorization`
  header on the very first request — the camera silently drops requests that don't look
  enough like the official app.
- The camera presents a self-signed TLS certificate; certificate verification is disabled.
- Auto-discovery sweeps the local /24 only. Larger subnets (e.g. /23) are skipped to
  avoid flooding.
