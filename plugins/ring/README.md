# Ring Plugin for Scrypted

The Ring Plugin bridges compatible Ring Cameras in Scrypted to HomeKit.

## Notes

Do not enable prebuffer on Ring cameras and doorbells.
  * The persistent live stream will cause motion event delivery to stop functioning.
  * The persistent live stream will drain the battery faster than it can charge.
  * The persistent live stream will also count against ISP bandwidth limits.
