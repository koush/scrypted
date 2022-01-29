## Gen 1 Camera Setup

Install the Rebroadcast Plugin. Since this is a cloud camera, prebuffering is not enabled by default. This means that any motion leading up to an event may not be captured. Enable prebuffering if your internet service will not have bandwidth issues with a persistent connection continually downloading your camera stream.

Gen 1 Cameras only provide recent event snapshots. If there was no recent event, you will see "Snapshot Unavailable" in HomeKit while the stream is inactive. If prebuffering is enabled, the snapshots will always be available.

The Gen 1 Camera requires HomeKit Transcoding to be enabled. Under the HomeKit Transcoding settings, enable transcoding on streams and recordings. Leave the decoder and encoder arguments blank. The defaults have been found to work the most reliably.
