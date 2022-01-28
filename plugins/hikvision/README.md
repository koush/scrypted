# HikVision Plugin
The HikVision Plugin brings HikVision-branded cameras, doorbells or NVR devices that are IP-based into Scrypted.
Most commonly this plugin is used with 2 plugins: Rebroadcast and HomeKit.

Device must have built-in motion detection (most HikVision cameras or NVR's have this).
If the camera or NVR do not have motion detection, you will have to use a separate plugin or device to achieve this (e.g., `dummy-switch`) and group it to the camera.

## Codec Settings for HomeKit
Configure optimal code settings (as required by HomeKit) through HikVision's configuration webpage or device interface (not Scrypted).
HikVision's [iVMS 4200 software](https://www.hikvision.com/en/support/tools/), or similar, may be utilized to configure device.

The optimal/reliable codec settings can be found in the documentation for the [Homekit Plugin](https://github.com/koush/scrypted/tree/main/plugins/homekit).

## HikVision NVR
Cameras attached or recording through a HikVision NVR (IP-based) can be used in HikVision Plugin for Scrypted. 
Each 'Channel' or (camera) Device attached to the NVR must be configured as separate Device in HikVision plugin.

**NOTE:** Snapshots may be inconsistent if using an NVR.  A workaround exists if you can access your camera on network without going through NVR (see below `Snapshot URL Override`).  If you can only access your camera through an NVR, then snapshots may not be supported.

* `IP Address` NVR's IP Address
* `Snapshot URL Override` camera's IP address (preferred) or specific port number of NVR for that camera (may work). That is: `http://<camera ip address>/cgi-bin/snapshot.cgi` or `http://<NVR ip address>:<NVR port # for camera>/cgi-bin/snapshot.cgi`
* `Channel Number Override` camera's channel number as known to DVR
* `Default Stream` Properly configured video codec stream (Main Stream = `Stream 1`; Sub Stream 1 = `Stream 2`; Sub Stream 2 = `Stream 3`; and so on)

# Troubleshooting
## Known Issues
* HikVision devices may crash on repeated snapshot requests (`Error 400` in Scrypted device console log). Use an `Override Snapshot URL` to request a lower resolution snapshot `http://<device IP address>/ISAPI/Streaming/channels/<channel number>/picture?videoResolutionWidth=1280&videoResolutionHeight=720`.
 
## General
* Not receiving motion alerts in the device's Scrypted event log? Check all of the following: **(1)** device has detection grid drawn and enabled, **(2)** user or group access permissions of account used for device **(3)** do not use self-signed certs for HTTPS on the device, and **(4)** CGI protocol/service on device is enabled. 
* If device has HTTPS enabled, try disabling HTTPS on the device to see if that resolves issue (do not use self-signed certs).
* Does your account (`Username`) have proper user and/or group permissions?  Try granting all permissions for testing. 
* Screenshots not working?  Check that `CGI` protocol is enabled in device settings (may be located at Network->Advanced Settings->Integration Protocol).
* 
* Check that you have specified the correct `Default Stream` number in device (in Scrypted).
* Check that you have configured the correct Stream number's codec settings (in device's configuration page (Main Stream or Sub Stream(s)).
 
## User Account Authority (Camera or NVR)
If you have a non-admin user account setup on your cameras and/or NVR, then the account's access permissions must be sufficient to expose motion events and playback.  At minimum this means `alertStream` access and/or `operator` user group. 


# Development
## npm commands 
 * npm run scrypted-webpack
 * npm run scrypted-deploy `<ipaddress>`
 * npm run scrypted-debug `<ipaddress>`
 
## scrypted distribution via npm
 1. Ensure package.json is set up properly for publishing on npm.
 2. npm publish

## Visual Studio Code configuration

* If using a remote server, edit [.vscode/settings.json](blob/master/.vscode/settings.json) to specify the IP Address of the Scrypted server.
* Launch Scrypted Debugger from the launch menu.


