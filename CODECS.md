# Scrypted Codec Settings

These codec settings are the optimal settings for streaming destinations within Scrypted. Streaming destinations include:
  * HomeKit
  * Google Home
  * Alexa
  * Chromecast
  * Web

* h264 video. Do **NOT** use H.264+, "Super" H.264, H.264B, or any other fancy variant. **TURN IT OFF**. Sometimes this unsupported variant setting is called "Smart Code(c)" and it should be set to "Close" or "Off".
* Configure all available camera substreams. Not all cameras may have a third stream.
  * 1080p Cameras:
    * 1920x1080, 2 Mbit variable bitrate (local streaming)
    * 1280x720, 1 Mbit, variable bitrate (remote/low streaming)
    * 640x480p, 500 Kbit variable bitrate (low streaming, if a third stream is available)
  * 2K Cameras:
    * 2560x1440, 3 Mbit variable bitrate (local streaming)
    * 1280x720, 1 Mbit, variable bitrate (remote/low streaming)
    * 640x480p, 500 Kbit variable bitrate (low streaming, if a third stream is available)
  * 4K Cameras:
    * 3840x2160, 8 Mbit, variable bitrate (local streaming)
    * 1280x720, 1 Mbit, variable bitrate (remote/low streaming)
    * 640x480p, 500 Kbit variable bitrate (low streaming, if a third stream is available)
* 4 second keyframe interval
  * `Keyframe Interval` is the number of seconds between keyframes. `Frame Interval` is the number frames between keyframes.
  * Cameras are typically configured in `Frame Interval` rather than `Keyframe Interval`. The formula for `Frame Interval` value is: `Frame Interval = 4 * FPS`. So if `FPS` is `30` as specified, `Frame Interval` should be set to `120`.
* Audio codecs, in order of preference:
  * Opus (used for live streaming to HomeKit or web)
  * PCM-ulaw/G711u (raw format suitable for web)
