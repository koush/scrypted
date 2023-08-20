# Reolink Plugin for Scrypted

Reolink Cameras offer both RTMP and RTSP streams. RTMP streams are more reliable than RTSP on Reolink Cameras, and offers 3 streaming tiers. RTMP streams will be preferred by default. The defaults can be changed in the camera's Rebroadcast `Stream Management` settings.

## Feature Support

    * Reolink Cameras
        * Two Way Audio - Reolink Two Way Audio is not supported. It is a proprietary and undocumented protocol.
    * Reolink Doorbells
        * Enable the Doorbell checkbox in the Scrypted settings for the Reolink device.
        * The Reolink Doorbell supports two way audio via ONVIF. Reolink Cameras do not support this feature.

Some Reolink cameras support the ONVIF protocol. It may be worth experimenting with the ONVIF plugin instead. Using the Reolink Plugin is generally recommended due to the additional stream that is made available.

## Camera Setup

Ensure that the following `Server Settings` are enabled. HTTPS **must** be disabled due to Reolink not handling https redirects properly.

<img width="806" alt="image" src="https://github.com/koush/scrypted/assets/73924/61d712a8-ddf9-4092-a0aa-cbec4e888766">
