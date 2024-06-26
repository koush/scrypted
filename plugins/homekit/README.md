# HomeKit Plugin for Scrypted

The HomeKit Plugin bridges compatible devices in Scrypted to HomeKit.

## Camera Codec Settings

You can use the admin page provided by your camera manufacturer to configure codec settings as required by HomeKit. It is highly recommended to configure the codec settings for *all* the camera substreams by using the [Scrypted Codec Settings guide](https://github.com/koush/scrypted/wiki/Codec-Settings). This will yield optimal local and remote streaming reliability.

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

2) After a motion trigger, the home hub will start recording. Verify that HomeKit is requesting recording by looking in the Camera's Console: you will see logs such as `[HomeKit]: Camera recording session starting`. If you do not see this, there are a few possible causes and solutions:
  * The Home Hubs are bugged out and have stopped responding to motion. Reboot all Home Hubs when this happens. **iPads and HomePods, which are wireless, are not reliable Home Hubs.** If you have an iPad as a Home Hub, remove it from acting as a Home Hub from within the iOS Home app. Unfortunately this is not possible to do with HomePods.
  * Your iCloud account is in a bad state. Log out of iCloud on your iPhone, and log back in. Then disable and reenable HomeKit Secure Video on your cameras again.
  * Your Scrypted server is on a different subnet from your home hub(s). This may work for live streaming, but home hubs will not initiate recording if they are on a different subnet. Ensure your Scrypted server is on the same subnet as the home hubs. 

3) If HomeKit requested the video, but nothing showed up in the timeline:
  * HomeKit may have decided the motion wasn't worth recording. Set your HomeKit recording options to all motion when testing.
  * The recordings are in a bad format that can't be used by HomeKit. See below for optimal HomeKit Codec Settings. Enabling `Debug Mode` (select `Transcode Video` and `Transcode Audio`) in the HomeKit settings for that camera may fix this for testing purposes, but long term usage is not recommended as it reduces quality and increases CPU load.
  * Try rebooting your Home Hubs (HomePods and AppleTVs). Make sure they are fully up to date.

### HomeKit Discovery and Pairing Issues

* Ensure all your Apple TV and Home Pods are online and updated. Power cycling them is recommended in case one is stuck.
* Ensure your Apple TV and Home Pods are on the same subnet as the Scrypted server.
* Ensure LAN/WLAN multicast is enabled on your router.
* Ensure the iOS device you are using for pairing is on the same network (pairing will fail on cellular).
* Ensure the Docker installation (if applicable) is using host networking. This configuration is the default if the official Scrypted Docker compose install script was used.
* Try switching the mDNS advertiser used in the HomeKit plugin settings.
* Try disabling IGMP Snooping on your router.

### HomeKit Live Streaming Timeout (Recordings may be working)

This is always a issue with the network setup. 
  * Ensure you are not connected to a VPN.
  * You may have multiple network interfaces, such as wired and wireless, and HomeKit is preferring the wireless interface. Use the [`Scrypted Server Address` setting](/endpoint/@scrypted/core/public/#/component/settings), and set it to your wired IP address manually.
  * Flatten your network topology. If your camera/server/iOS are on a separate VLANs, try disabling VLANs to determine if that is the issue.
  * You wifi network is saturated, resulting in heavy packet loss. Enabling Transcode Debug Mode in the HomeKit settings for that camera may fix this for testing purposes, but long term usage is not recommended as it reduces quality and increases CPU load.
  * This is *may* be a codec issue (but as mentioned earlier, is usually a network issue). Try enabling Transcoding on both Live and Remote streams.

### HomeKit Remote Streaming not Working

This almost always due to your camera bitrate being too high for remote streaming through Apple's servers. Workarounds:
1) Use a lower bitrate substream for Remote Streaming.
2) Enable Transcoding on Remote Streaming.

Other things to check:
1) Ensure the Home app has cellular network permission.


### mDNS Advertiser Options

Scypted uses mDNS-based to make your accessories discoverable by Apple devices.
There are 3 mDNS Advertisers that Scrypted can interface with to advertise itself on the local network.


#### Ciao

Ciao is the default advertiser that scypted uses.

For non-Linux users, `ciao` should provide the best experience. It fixes a lot of the deficiencies of the `bonjour` advertiser. However, you might experience issues in the following two scenarios.

##### Network Interface Selection
Ciao tries to be aware of multiple network interfaces. 
On startup, it tries to evaluate which network interfaces to advertise on by default.
In certain circumstances, ciao is unable to properly determine the set of valid network interfaces (e.g., when dealing with virtual network interfaces on containerised environments).

##### Multiple Advertisers
On some systems, there is already a mDNS advertiser stack running (e.g. avahi on linux). There might be issues running multiple mDNS advertisers on the same host.

#### Bonjour

Bonjour is a legacy advertiser. It is not as efficient in terms of system resource usage and network traffic when compared to the other options.

#### Avahi (Linux Only)
Avahi is a mDNS advertiser that is installed by default on many linux distributions.

For Linux users, Avahi should provide the best experience.
Note that your system must have the `avahi-daemon` and `dbus` services installed and running for this option to work.

If using Scypted through `docker compose`, be sure to uncomment the volume mounts to expose Avahi to the container.
