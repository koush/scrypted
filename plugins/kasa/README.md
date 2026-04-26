# Kasa Camera Plugin

This plugin adds support for TP-Link Kasa cameras using the proprietary mixed multipart streaming protocol (port 19443, `/https/stream/mixed`). Streams are H.264 video + G.711 µ-law audio. Ported from [go2rtc](https://github.com/AlexxIT/go2rtc/tree/master/pkg/kasa).

Tested models (per go2rtc): KD110, KC200, KC401, KC420WS, EC71.

## Setup

1. Install the plugin.
2. Use **Add Camera** to create a new camera.
3. Configure the camera with:
   - **IP Address** of the camera on your LAN
   - **Port** (default 19443)
   - **Username** — your TP-Link/Kasa account email
   - **Password** — your TP-Link/Kasa account password
4. The plugin will connect to the camera and re-stream the H.264 + G.711 µ-law feed locally over RTSP for Scrypted.

## Notes

- Two-way audio is not yet implemented.
- Device discovery is not yet implemented; cameras must be added manually.
