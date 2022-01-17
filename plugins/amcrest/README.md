# Amcrest Plugin
The Amcrest Plugin brings Amcrest-branded cameras, doorbells or NVR devices that are IP-based into Scrypted.
Most commonly this plugin is used with 2 plugins: Rebroadcast and HomeKit.

Device must have built-in motion detection (most Amcrest cameras or NVR's have this).
If the camera or NVR do not have motion detection, you will have to use a separate plugin or device to achieve this (e.g., `dummy-switch`) and group it to the camera.

## Amcrest Camera Codec Settings for HomeKit Compatibility
Configure optimal code settings (as required by HomeKit) using Amcrest configuration (not Scrypted).

You may use the device's webpage access or one of the following applications: `Amcrest Smart Home` (mobile), `IP Config Software`, or `Amcrest Surveillance Pro`  (https://support.amcrest.com/hc/en-us/categories/201939038-All-Downloads).  
**NOTE:** Amcrest Smart Home app may not expose all codec or stream settings. Use one of the other applications instead.

* h264 video with aac audio (Do **NOT** use H.264+, "Super" H.264, H.264B or any other fancy variant. **TURN IT OFF**.)
* 1920x1080 (max resolution)
* 2 Mbit variable bitrate (though up to 6Mbit may work)
* 30 frames per second (FPS or Frame Rate) is recommended
* 4 second `Keyframe Interval` (number of seconds between keyframes)
  * Amcrest cameras are typically configured in `Frame Interval` (the number frames between keyframes)
  * To achieve 4 second `Keyframe Interval`, use calculation:  `Frame Interval / FPS = 4` or `4 * FPS = Frame Interval`
  * Both `Frame Rate (FPS)` and `Frame Interval` are editable fields in Amcrest configuration (sometimes it does not look editable, but it is.)
  * Example 1: If your Frame Rate (FPS) is 30, then Frame Interval = 120 (`Frame Interval / 30 = 4` ; `Frame Interval = 4 * 30` ; `Frame Interval = 120`)
  * Example 2: If your Frame Rate (FPS) is 15, then Frame Interval = 60 (`Frame Interval / 15 = 4` ; `Frame Interval = 4 * 15` ; `Frame Interval = 60`)

## Amcrest Doorbells (e.g. AD110 and AD410)
At this time, 2-way audio works for AD110 and not AD410.

* Specify `Type` is `Doorbell`
* `Username` admin
* `Password` (see below)
* `Default Stream` set to properly configured video codec stream (Main Stream = `Stream 1`; Sub Stream 1 = `Stream 2`; Sub Stream 2 = `Stream 3`; and so on)
* `Amcrest Doorbell` is `checked` 
 
The `admin` user account credentials is required to (1) add doorbell to Scrypted or (2) change codec settings with `IP Config Software` or `Amcrest Surveillance Pro` applications. 

The password for `admin` username was set when first configuring device (see 2m49s mark of https://youtu.be/8RDgBMfIhgo).  
The `admin` username credential is **not** your Amcrest Smart Home (cloud) account that uses an email address for user/login.
(Unless you happened used the same password for both.)

## Amcrest NVR
Cameras attached or recording through an Amcrest NVR (IP-based) can be used in Amcrest Plugin for Scrypted. 
Each 'Channel' or (camera) Device attached to the NVR must be configured as separate Device in Amcrest plugin.

**NOTE:** Snapshots may be inconsistent if using an NVR.  A workaround exists if you can access your camera on network without going through NVR (see below `Snapshot URL Override`).  If you can only access your camera through an NVR, then snapshots may not be supported.

* `IP Address` NVR's IP Address
* `Snapshot URL Override` camera's IP address (preferred) or specific port number of NVR for that camera (may work). That is: `http://<camera ip address>/cgi-bin/snapshot.cgi` or `http://<NVR ip address>:<NVR port # for camera>/cgi-bin/snapshot.cgi`
* `Channel Number Override` camera's channel number as known to DVR
* `Default Stream` Properly configured video codec stream (Main Stream = `Stream 1`; Sub Stream 1 = `Stream 2`; Sub Stream 2 = `Stream 3`; and so on)



# Troubleshooting
## General
* Is the URL attempting to use HTTPS?  Try disabling HTTPS on the device to see if that resolves issue (do not use self-signed certs).
* Does your account (`Username`) have proper permissions ("Authority" in Amcrest speak)?  Try granting all Authority for testing.  See below `User Account Authority (Camera or NVR)`.
* Amcrest Doorbell: `Username` is **admin** and `Password` is the device/camera password -- not Amcrest Smart Home (Cloud) account password.
* Check that you have specified the correct `Default Stream` number in device (in Scrypted).
* Check that you have configured the correct Stream number's codec settings (in Amcrest admin page (Main Stream or Sub Stream(s)).

## User Account Authority (Camera or NVR)
If you have a non-admin user account setup on your cameras and/or Amcrest NVR, then the account's access permissions must be sufficient to expose motion events and playback.

The following is known to work (and are likely over permissive), but your specific camera model and firmware may be different:
* Camera user Group Authority: `Live`, `Playback`, `Storage`, `Event`
* NVR user Group Authority: `Camera`, `Storage`, `Event Management`

# Development

## npm commands
 * npm run scrypted-webpack
 * npm run scrypted-deploy <ipaddress>
 * npm run scrypted-debug <ipaddress>

## scrypted distribution via npm
 1. Ensure package.json is set up properly for publishing on npm.
 2. npm publish

## Visual Studio Code configuration

* If using a remote server, edit [.vscode/settings.json](blob/master/.vscode/settings.json) to specify the IP Address of the Scrypted server.
* Launch Scrypted Debugger from the launch menu.
