# Amcrest Plugin for Scrypted
The Amcrest Plugin brings Amcrest-branded cameras, doorbells or NVR devices that are IP-based into Scrypted.
Most commonly this plugin is used with 2 plugins: `Rebroadcast` and `HomeKit`.

Device must have built-in motion detection (most Amcrest cameras or NVRs have this).
If the camera or NVR do not have motion detection, you will have to use a separate plugin or device to achieve this (e.g., `opencv`, `pam-diff`, or `dummy-switch`) and group it to the camera.

## Codec Settings for HomeKit
Configure optimal codec settings (as required by HomeKit) using Amcrest configuration (not Scrypted).

You may use the device's webpage access or one of the following applications from [Amcrest website](https://support.amcrest.com/hc/en-us/categories/201939038-All-Downloads): `Amcrest Smart Home` (mobile), `IP Config Software`, or `Amcrest Surveillance Pro`.  
**NOTE:** Amcrest Smart Home app may not expose all codec or stream settings. Use one of the other applications instead.

The optimal/reliable codec settings can be found in the documentation for the [Homekit Plugin](https://github.com/koush/scrypted/tree/main/plugins/homekit).

## Amcrest Doorbells (e.g. AD110 and AD410)

* Specify `Type` is `Doorbell` (at top under device Name)
* `Username` admin
* `Password` (see below)
* `Doorbell Type` is `Amcrest Doorbell` 
 
The `admin` user account credential is required to (1) add doorbell to Scrypted or (2) change codec settings with `IP Config Software` or `Amcrest Surveillance Pro` applications. 

The password for `admin` username was set when first configuring device (see 2m49s mark of [Amcrest setup video](https://youtu.be/8RDgBMfIhgo)).  
The `admin` username credential is **not** your Amcrest Smart Home (cloud) account that uses an email address for user/login.
(Unless you happened to use the same password for both.)

If you experience doorbell restarts/crashes when beginning a two-way talk (whether ONVIF or Amcrest selected) then use the Amcrest Smart Home app, navigate to Device Information, and disable/toggle off the option [Record Audio](https://user-images.githubusercontent.com/38480370/204055791-87f82a44-518d-46b3-8444-5c47d1e7f66a.png).
Note that this will disable audio recordings to SD card (if present in doorbell), but now two-way talk over Homekit should work.

## Amcrest NVR
Cameras attached or recording through an Amcrest NVR (IP-based) can be used in Amcrest Plugin for Scrypted. 
Each 'Channel' or (camera) Device attached to the NVR must be configured as separate Device in Amcrest plugin.

**NOTE:** Snapshots may be inconsistent if using an NVR.  A workaround exists if you can access your camera on network without going through NVR (see below `Snapshot URL Override`).  If you can only access your camera through an NVR, then snapshots may not be supported.

* `IP Address` NVR's IP Address
* `Snapshot URL Override` camera's IP address (preferred) or specific port number of NVR for that camera (may work). That is: `http://<camera IP address>/cgi-bin/snapshot.cgi` or `http://<NVR IP address>:<NVR port # for camera>/cgi-bin/snapshot.cgi`
* `Channel Number Override` camera's channel number as known to DVR

## Dahua Lock/Unlock
Dahua DTO video intercoms have built-in access control for locks/doors. If you have set the Amcrest plugin up with `Doorbell Type` set to `Dahua Doorbell`, you can enable support for remotely locking/unlocking by enabling/toggle the option `Enable Dahua Lock`.

# Troubleshooting
## General
* Are your Amcrest streams properly enabled and configured?  (in Amcrest admin page (Main Stream or Sub Stream(s)).
* Are the correct Amcrest streams specified in camera's Stream Management (in Scrypted) per source of stream (i.e., local, remote, low resolution, etc.)?
* Is the URL attempting to use HTTPS?  Try disabling HTTPS on the device to see if that resolves issue (do not use self-signed certs).
* Does your account (`Username`) have proper permissions ("Authority" in Amcrest speak)?  Try granting all Authority for testing.  See below `User Account Authority (Camera or NVR)`.
* Amcrest Doorbell: `Username` is **admin** and `Password` is the device/camera password -- not Amcrest Smart Home (Cloud) account password.
* Amcrest Doorbell: Two-way talk crashing doorbell? Disable [Record Audio](https://user-images.githubusercontent.com/38480370/204055791-87f82a44-518d-46b3-8444-5c47d1e7f66a.png) using `Amcrest Smart Home` mobile app.

## User Account Authority (Camera or NVR)
If you have a non-admin user account setup on your cameras and/or Amcrest NVR, then the account's access permissions must be sufficient to expose motion events and playback.

The following is known to work (and are likely over permissive), but your specific camera model and firmware may be different:
* Camera user Group Authority: `Live`, `Playback`, `Storage`, `Event`
* NVR user Group Authority: `Camera`, `Storage`, `Event Management`
