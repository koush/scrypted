# Reolink Plugin for Scrypted

Reolink Cameras offer both RTMP and RTSP streams. RTMP streams are more reliable than RTSP on Reolink Cameras, and offers 3 streaming tiers. RTMP streams will be preferred by default. The defaults can be changed in the camera's Rebroadcast `Stream Management` settings.

## Feature Support

    * Reolink Cameras
        * Two Way Audio - Reolink Two Way Audio is not supported. It is a proprietary and undocumented protocol.
    * Reolink Doorbells
        * Enable the Doorbell checkbox in the Scrypted settings for the Reolink device.
        * The Reolink Doorbell supports two way audio via ONVIF. Reolink Cameras do not support this feature.

### Doorbells connected through an NVR

Doorbell channels are detected automatically from their reported model. Enable **Doorbell** in the channel's Scrypted settings if the model is not recognized. Existing channels are updated when the plugin starts or refreshes device information.

Enable **ONVIF** on the NVR and set the matching **ONVIF Port** on the Scrypted NVR device (default: **8000**). The NVR must forward ONVIF `Visitor` events with a numeric channel source. Each press updates only that doorbell's binary sensor; motion events alone do not indicate a button press. Button state is not polled, and a missing release clears after five seconds.

Enable **Debug Events** on the NVR device to inspect received events. After enabling **Doorbell**, reload the HomeKit plugin to publish the native bell service. The optional **Doorbell Automation Button** is not required for ring notifications.

Some Reolink cameras support the ONVIF protocol. It may be worth experimenting with the ONVIF plugin instead. Using the Reolink Plugin is generally recommended due to the additional stream that is made available.

## Camera Setup

Ensure that the following `Server Settings` are enabled. HTTPS **must** be disabled due to Reolink not handling https redirects properly.

<img width="806" alt="image" src="https://github.com/koush/scrypted/assets/73924/61d712a8-ddf9-4092-a0aa-cbec4e888766">
