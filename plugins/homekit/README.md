# HomeKit Plugin for Scrypted

The HomeKit Plugin bridges compatible devices in Scrypted to HomeKit.

## HomeKit Camera Codec Settings

You can use the admin page provided by your camera manufacturer to set the optimal codec settings as required by HomeKit:

* h264 video with aac audio (Do **NOT** use H.264+, "Super" H.264, H.264B or any other fancy variant. **TURN IT OFF**.)
* 1920x1080
* 2 Mbit variable bitrate (though up to 6Mbit may work)
* 4 second keyframe interval
  * `Keyframe Interval` is the number of seconds between keyframes. `Frame Interval` is the number frames between keyframes.
  * Cameras are typically configured in `Frame Interval` rather than `Keyframe Interval`. The formula for `Frame Interval` value is: `Frame Interval = 4 * FPS`. So if `FPS` is `30` as specified, `Frame Interval` should be set to `120`.

## Troubleshooting

### HomeKit Discovery and Pairing Issues

If HomeKit is not discoverable, make sure LAN/WLAN multicast is enabled on your router.
If HomeKit fails while pairing during a Docker install, ensure host networking is being used.

### HomeKit Live Streaming Timeout (Recordings maybe working)

This is a networking issue with multiple interfaces. This is the problem 100% of the time. Use the HomeKit Address Override setting, and set it to the IP Address of your ethernet manually.
If your camera is on a separate VLAN, try disabling that to see if that is the issue.


### HomeKit Secure Video Not Recording

If recordings dont work, it's generally because of a few reasons, **follow the steps to determine where it is failing before asking for help**:

1) The motion wasn't triggered. You can view if there are motion events in the camera "Events" section.

2) After a motion trigger, the home hub will start recording. Verify that HomeKit is requesting recording by looking in the Camera's Console: you will see logs such as `[HomeKit]: Camera recording session starting`. Sometimes the home hubs bug out and stop responding to motion. Try rebooting the home hub(s) when this happens. **iPads and HomePods, which are wireless, are not reliable home hubs.**

3) The recordings are in a bad format that can't be used by HomeKit. See below for optimal HomeKit Codec Settings. Enabling Transcode Recordings may fix this for testing purposes, but long term usage is not recommended as it reduces quality and increases CPU load. 

4) HomeKit decided the motion wasn't worth recording. Set your HomeKit recording options to all motion when testing.

5) If your camera is on a separate VLAN, try disabling that to see if that is the issue.