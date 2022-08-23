# HikVision Plugin for Scrypted
The HikVision Plugin brings HikVision-branded cameras, doorbells or NVR devices that are IP-based into Scrypted.
Most commonly this plugin is used with 2 plugins: Rebroadcast and HomeKit.

Device must have built-in motion detection (most HikVision cameras or NVRs have this).
If the camera or NVR do not have motion detection, you will have to use a separate plugin or device to achieve this (e.g., `opencv`, `pam-diff`, or `dummy-switch`) and group it to the camera.

## Two Way Audio

Two Way Audio is supported if the audio codec is set to PCM-ULAW (G.711ulaw) on the camera. This audio codec will also work with HomeKit. Using ONVIF Two Way is recommended.

## Codec Settings for HomeKit
Configure optimal codec settings (as required by HomeKit) through HikVision's configuration webpage or device interface (not Scrypted).

HikVision's [iVMS 4200 software](https://www.hikvision.com/en/support/tools/), or similar, may be utilized to configure device as well as create a motion detection grid (required for motion detection and hardware dependent).

Generally, for newer devices the main stream (Stream 1) may be incompatible with HomeKit.
Configure and specify a substream instead (Stream 2 or 3).

The optimal/reliable codec settings can be found in the documentation for the [Homekit Plugin](https://github.com/koush/scrypted/tree/main/plugins/homekit).

## HikVision NVR
Cameras attached or recording through a HikVision NVR (IP-based) can be used in HikVision Plugin for Scrypted. 
Each 'Channel' or (camera) Device attached to the NVR must be configured as separate Device in HikVision plugin.
The Channel number is the hundreds digit and (sub-)stream is ones digit:
* 101 = Camera 1 (1xx), stream 1 (xx1 = main stream)
* 102 = Camera 1 (1xx), stream 2 (xx2 = sub-stream 1)
* 203 = Camera 2 (2xx), stream 3 (xx3 = sub-stream 2)

**NOTE:** Snapshots may be inconsistent if using an NVR.  A workaround exists if you can access your camera on network without going through NVR (see below `Snapshot URL Override`).  If you can only access your camera through an NVR, then snapshots may not be supported.

* `IP Address` NVR's IP Address
* `Snapshot URL Override` camera's IP address (preferred) or specific port number of NVR for that camera (may work). That is: `http://<camera ip address>/ISAPI/Streaming/channels/<channel number>/picture` or `http://<NVR IP address>:<NVR port # for channel>/ISAPI/Streaming/channels/<channel number>/picture`. 720p snapshots seem to be more stable than 1080p or higher: `http://<NVR IP address>/ISAPI/Streaming/channels/<channel number>/picture?videoResolutionWidth=1280&videoResolutionHeight=720`
* `HTTP Port Override` check your NVR device settings (it may be `1080` instead of `80`)
* `Channel Number Override` camera's channel number as known to DVR (i.e., 101, 102, 103, etc.)
* `Default Stream` Properly configured video codec stream (Main Stream = `Stream 1`; Sub Stream 1 = `Stream 2`; Sub Stream 2 = `Stream 3`; and so on)

# Troubleshooting
## General
* Not receiving motion alerts in the device's Scrypted event log? Check all of the following: **(1)** device has a motion detection grid drawn and enabled, **(2)** user or group access permissions of account used for device **(3)** do not use self-signed certs for HTTPS on the device, and **(4)** `CGI` and `ISAPI` integration protocol/service on device is enabled. 
* If device has HTTPS enabled, try disabling HTTPS on the device to see if that resolves issue (do not use self-signed certs).
* If device has enabled user lockout, max connections, concurrent requests, etc., try disabling and/or increasing to max allowed for troubleshooting.
* Does your account (`Username`) have proper user and/or group permissions?  Try granting all permissions for testing. 
* Screenshots not working?  Check that **(1)** `CGI` protocol is enabled in device settings (may be located at Network->Advanced Settings->Integration Protocol) and **(2)** lower Snapshot resolution with an `Override Snapshot URL` (above) to request a lower resolution snapshot (i.e. 720p or lower).
* Check that you have specified the correct `Default Stream` number in device (in Scrypted).
* Check that you have configured the correct Stream number's codec settings (in HikVision's configuration page (Main Stream or Sub Stream(s)).
 
## User Account Permission (Camera or NVR)
If you have a non-owner/admin user account setup on your cameras and/or NVR, then the account's access permissions must be sufficient to expose motion events/alerts,  playback, and snapshot.  Depending on device type, at minimum this may require the following permissions:
* `alertStream`
* `Playback` and `Live View`
* `Event` / `Notification`
* `operator` (user group)
