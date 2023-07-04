# Ring Plugin for Scrypted

The Ring Plugin bridges compatible Ring Cameras in Scrypted to HomeKit.

## Notes

Do not enable prebuffer on Ring cameras and doorbells.
  * The persistent live stream will cause motion event delivery to stop functioning.
  * The persistent live stream will drain the battery faster than it can charge.
  * The persistent live stream will also count against ISP bandwidth limits.

## Supported Devices

### Cameras
- Ring Video Doorbell Wired, Pro, Pro 2, 4, 3, 2nd Gen
- Ring Floodlight Cam Wired Plus
- Ring Floodlight Cam Wired Pro
- Ring Spotlight Cam (Wired and Battery)
- Ring Indoor Cam
- Ring Stick-Up Cam (Wired and Battery)

### Other Devices
- Security Panel
- Location Modes
- Contact Sensor
- Retrofit Alarm Zones
- Tilt Sensor
- Glassbreak Sensor
- Motion Sensor
- Outdoor Motion Sensor
- Flood / Freeze Sensor
- Water Sensor
- Mailbox Sensor
- Smart Locks
- Ring Smart Lights (Flood/Path/Step/Spot Lights, Bulbs, Transformer)
- Lights, Switches & Outlets

## Problems and Solutions

### Motion and Doorbell Events are not delivered.

See the [Ring Notification Troubleshooting](https://github.com/dgreif/ring/wiki/Notification-Troubleshooting) guide and clear all devices.

### I can see artifacts in HKSV recordings
- Check WiFi connection of the camera. If Camera have low signal, it will cause Packet Loss and create artifacts in the recordings.

### I can constantly see Live View recodings in Ring App
- Turn off "PAM DIFF", "OPEN CV" and "PREBUFFER". All of these will cause continous connection to Live View. This will stop motion event delivery and clutter Ring app with Live View Recordings.

### Not all motions are recorded in Home app (they dont match with Ring app)
- Check your motion settings in Ring app. I recommend to turn off "Smart Alerts", sometimes when notifications are turned off for "Other Motion" it will caouse that only "People" motion Events are sent to Scrypted.

### Do I need to pay for Ring Connect in order to record Ring Doorbell Motion in HKSV?
- No.

### Recording in HKSV starts few seconds after recording in Ring app
- The reason for this issue is usually a delay in the network's processing. When motion is detected by Ring, the information is sent to its server and then relayed back to scrypted. Even with a fast, wired network, there is often some lag and video capture may be lost during events.
