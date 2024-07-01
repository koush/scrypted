# Hikvision Doorbell Plugin for Scrypted (beta)

This plugin is based on [Hikvision Plugin for Scrypted](https://www.npmjs.com/package/@scrypted/hikvision), which is part of the [Scrypted](https://github.com/koush/scrypted) project.

The Hikvision Doorbell Plugin brings Hikvision-branded doorbells that are IP-based into Scrypted.
Most commonly this plugin is used with 2 plugins: Rebroadcast and HomeKit.

Device must have built-in motion detection (most Hikvision doorbells have this).
If the doorbell do not have motion detection, you will have to use a separate plugin or device to achieve this (e.g., `opencv`, `pam-diff`, or `dummy-switch`) and group it to the doorbell.

## Two Way Audio

Two Way Audio is supported if the audio codec is set to G.711ulaw on the doorbell, which is usually the default audio codec. This audio codec will also work with HomeKit. Changing the audio codec from G.711ulaw will cause Two Way Audio to fail on the doorbells that were tested.

## Codec Settings

Configure optimal codec settings (as required by HomeKit) through Hikvision's configuration webpage or device interface (not Scrypted).

Hikvision's [iVMS 4200 software](https://www.Hikvision.com/en/support/tools/), or similar, may be utilized to configure device as well as create a motion detection grid (required for motion detection and hardware dependent).

Generally, for newer devices the main stream (Stream 1) may be incompatible with HomeKit as it only outputs HEVC.
Configure and specify a substream instead (Stream 2 or 3).

The optimal/reliable codec settings can be found in the documentation for the [Homekit Plugin](https://github.com/koush/scrypted/tree/main/plugins/homekit).

# Troubleshooting

* Not receiving motion alerts in the device's Scrypted event log? Check all of the following: **(1)** device has a motion detection grid drawn and enabled, **(2)** user or group access permissions of account used for device **(3)** do not use self-signed certs for HTTPS on the device, **(4)** `CGI` and `ISAPI` integration protocol/service on device is enabled, and **(5)** that the authentication method on the device is set to "digest". 
* If device has HTTPS enabled, try disabling HTTPS on the device to see if that resolves issue (do not use self-signed certs).
* If device has enabled user lockout, max connections, concurrent requests, etc., try disabling and/or increasing to max allowed for troubleshooting.
* Does your account (`Username`) have proper user and/or group permissions?  Try granting all permissions for testing. 
* Screenshots not working?  Check that **(1)** `CGI` protocol is enabled in device settings (may be located at Network->Advanced Settings->Integration Protocol) and **(2)** lower Snapshot resolution with an `Override Snapshot URL` (above) to request a lower resolution snapshot (i.e. 720p or lower).
* Check that you have specified the correct `Default Stream` number in device (in Scrypted).
* Check that you have configured the correct Stream number's codec settings (in Hikvision's configuration page (Main Stream or Sub Stream(s)).
