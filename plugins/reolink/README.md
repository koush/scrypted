# Reolink Plugin for Scrypted

Reolink Cameras offer both RTMP and RTSP streams. RTMP streams are more reliable than RTSP on Reolink Cameras, and offers 3 streaming tiers. RTMP streams will be preferred by default. The defaults can be changed in the camera's Rebroadcast `Stream Management` settings.

## Feature Support

- **Standalone Reolink doorbells:** Enable **Doorbell** in the device's Scrypted settings. Two-way audio uses ONVIF.
- **Doorbells connected through a Reolink NVR:** Doorbell detection, button presses, and native Reolink two-way audio are supported as described below. The doorbell can remain on the NVR's private network.
- Native Reolink talk audio is currently limited to NVR doorbell channels. Other camera channels retain their existing ONVIF audio option.

Some Reolink cameras support the ONVIF protocol. It may be worth experimenting with the ONVIF plugin instead. Using the Reolink Plugin is generally recommended due to the additional stream that is made available.

### Doorbells connected through an NVR

1. Add the NVR using its address and account credentials in Scrypted.
2. Enable **ONVIF** in the NVR's network/server settings. Set the matching **ONVIF Port** on the Scrypted NVR device (default: **8000**) for button events.
3. Enable the NVR's **Server Port** for native talk audio. Set the matching **Reolink Server Port** on the Scrypted NVR device (default: **9000**).
4. Open the doorbell channel in Scrypted. Confirm **Doorbell** is enabled and **Advanced → Two-Way Audio** is set to **Reolink**.

Doorbell channels are detected automatically from their reported model. For an unrecognized model, enable **Doorbell** manually. Existing channels are updated when the plugin starts or refreshes device information.

Button presses use one shared ONVIF event subscription, with each event routed to its source channel. The NVR must forward ONVIF `Visitor` events with a numeric channel source. Doorbell state is not polled, and a missing release clears automatically after five seconds. Enable **Debug Events** on the NVR device to inspect received events. Motion events alone do not establish that button presses are being forwarded.

Two-way audio uses the native Reolink protocol through the NVR account and doorbell channel. It does not require direct access to the doorbell's private IP address or an ONVIF audio backchannel. The NVR must advertise ADPCM talk support for that channel. **Reolink** is the default audio method; channels where audio was explicitly disabled keep it disabled.

Select **ONVIF** only if the NVR stream exposes an ONVIF audio backchannel. Select **Disabled** to remove talk support. If native talk is rejected as busy, close any active talk session in the Reolink app before trying again.

### Apple Home

Enable the HomeKit extension for the doorbell channel. Reload the HomeKit plugin after enabling **Doorbell** or changing **Two-Way Audio** so it publishes the updated bell and audio controls. Open the live view in Apple Home and allow microphone access when testing talk audio.

The native bell service is part of the camera accessory. The optional **Doorbell Automation Button** in the device's HomeKit settings adds a visible button for automations. That button is not required for ring notifications.

On the current Apple Home architecture, notifications require a supported Apple home hub, including when the iPhone is at home. The Scrypted server does not replace an Apple home hub. See [Apple's Home requirements](https://support.apple.com/en-us/102287). Once a hub is configured, enable the doorbell's notifications in Apple Home.

## Camera Setup

Enable the required network/server services on the camera or NVR. For NVRs, match Scrypted's **Use HTTPS** and **API Port** to the NVR's configuration; those API settings are separate from the ONVIF and Reolink server ports above. Some standalone cameras require HTTP because they do not handle HTTPS redirects correctly.

<img width="806" alt="image" src="https://github.com/koush/scrypted/assets/73924/61d712a8-ddf9-4092-a0aa-cbec4e888766">
