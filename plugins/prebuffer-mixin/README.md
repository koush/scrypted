# Rebroadcast and Prebuffer for Scrypted

This plugin maintains connections to all connected cameras, and buffers a small amount of recent video for instant replays. This instant replay is used by HomeKit Secure Video, as well as speeding up initial live stream load times.

## Stream Setup

The Rebroadcast Plugin will automatically select the best stream depending on the use. For example, a Unifi Camera has 3 available streams: `High`, `Medium`, and `Low`. Rebroadcast will automatically Prebuffer `High` for HomeKit Secure Video, and the stream selection will use the following defaults:

High: `Local Stream` (HomeKit on LAN) and `Local Recording Stream` (NVR)
Medium: `Remote (Medium Resolution) Stream` (HomeKit on cellular) and `Remote Recording Stream` (HomeKit Secure Video)
Low: `Low Resolution Stream` for Apple Watch, Video Analysis

Most cameras have at least 2 streams available and should be set up as follows:

High: 1080p+ (2000 Kbps)
Medium: 720p (500 Kbps)
Low (if available): 320p (100 Kbps)

The `Key Frame (IDR) Interval` should be set to `4` seconds. This setting is usually configured in frames. So if the camera frame rate is `30`, the interval would be `120`. If the camera frame rate is `15` the interval would be `60`. The value can be calculated as `IDR Interval = FPS * 4`.
