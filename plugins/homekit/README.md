# HomeKit Plugin for Scrypted

The HomeKit Plugin bridges compatible devices in Scrypted to HomeKit.

## HomeKit Camera Codec Settings

You can use the admin page provided by your camera manufacturer to set the optimal codec settings as required by HomeKit:

* h264 video with aac audio. Do **NOT** use H.264+, "Super" H.264, H.264B, or any other fancy variant. **TURN IT OFF**. Sometimes this unsupported variant setting is called "Smart Code(c)" and it should be set to "Close" or "Off".
* 1920x1080
* 2 Mbit variable bitrate (though up to 6Mbit may work)
* 4 second keyframe interval
  * `Keyframe Interval` is the number of seconds between keyframes. `Frame Interval` is the number frames between keyframes.
  * Cameras are typically configured in `Frame Interval` rather than `Keyframe Interval`. The formula for `Frame Interval` value is: `Frame Interval = 4 * FPS`. So if `FPS` is `30` as specified, `Frame Interval` should be set to `120`.

## Troubleshooting

### HomeKit Secure Video Not Recording

If recordings dont work, it's generally because of a few reasons, **follow the steps to determine where it is failing before asking for help**:

1) The motion wasn't triggered. You can view if there are motion events in the camera `Events` section (a small icon button next to the `Console` button`. If no motion event was delivered to Scrypted this may be for several reasons which may depend on the camera type, including:
  * Local cameras:
    * Motion detection is disabled in the camera. Enable in the camera manufacturer admin app/webpage.
    * There are no motion zone configured on the camera, and there is no default zone. Configure in the camera manufacturer admin app/webpage.
    * The camera may not support motion detection via that plugin (ie, an ONVIF camera not supporting the ONVIF-T profile). Using another delivery mechanism such as mail (SMTP) or webhook is an alernative and reliable option.
  * Cloud cameras:
    * Motion delivery issue from the cloud service.

2) After a motion trigger, the home hub will start recording. Verify that HomeKit is requesting recording by looking in the Camera's Console: you will see logs such as `[HomeKit]: Camera recording session starting`. If you do not see this, there are two possible causes and solutions:
  * The Home Hubs are bugged out and have stopped responding to motion. Reboot all Home Hubs when this happens. **iPads and HomePods, which are wireless, are not reliable Home Hubs.** If you have an iPad as a Home Hub, remove it from acting as a Home Hub from within the iOS Home app. Unfortunately this is not possible to do with HomePods.
  * Your iCloud account is in a bad state. Log out of iCloud on your iPhone, and log back in. Then disable and reenable HomeKit Secure Video on your cameras again.

3) If HomeKit requested the video, but nothing showed up in the timeline:
  * HomeKit may have decided the motion wasn't worth recording. Set your HomeKit recording options to all motion when testing.
  * The recordings are in a bad format that can't be used by HomeKit. See below for optimal HomeKit Codec Settings. Enabling Transcode Debug Mode in the HomeKit settings for that camera may fix this for testing purposes, but long term usage is not recommended as it reduces quality and increases CPU load.
  * Try rebooting your Home Hubs (HomePods and AppleTVs). Make sure they are fully up to date.

### HomeKit Discovery and Pairing Issues

If HomeKit is not discoverable, make sure LAN/WLAN multicast is enabled on your router.
If HomeKit fails while pairing during a Docker install, ensure host networking is being used.

### HomeKit Live Streaming Timeout (Recordings may be working)

This is always a issue with the network setup. 
  * Ensure you are not connected to a VPN.
  * You may have multiple network interfaces, such as wired and wireless, and HomeKit is preferring the wireless interface. Use the HomeKit Plugin's `Scrypted Server Address` setting, and set it to your wired IP address manually.
  * If your camera/server/iOS are on a separate VLANs, try disabling VLANs to determine if that is the issue.
  * You wifi network is saturated, resulting in heavy packet loss. Enabling Transcode Debug Mode in the HomeKit settings for that camera may fix this for testing purposes, but long term usage is not recommended as it reduces quality and increases CPU load.
  * This is *may* be a codec issue (but as mentioned earlier, is usually a network issue). Try enabling Transcoding on both Live and Remote streams.

### HomeKit Remote Streaming not Working

This almost always due to your camera bitrate being too high for remote streaming through Apple's servers. Workarounds:
1) Use a lower bitrate substream for Remote Streaming.
2) Enable Transcoding on Remote Streaming.
