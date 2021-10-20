# Scrypted Home Automation

<img width="400" alt="Scrypted_Management_Console" src="https://user-images.githubusercontent.com/73924/131903488-722d87ac-a0b0-40fe-b605-326e6b886e35.png">

## Discord

[Join Scrypted Discord](https://discord.gg/DcFzmBHYGq)

## Supported Platforms

 * Google Home
 * Apple HomeKit
 * Amazon Alexa

Supported accessories: 
 * https://github.com/koush/scrypted/tree/main/plugins

# Installation

## Run on Docker

[Docker Installation Instructions](https://github.com/koush/scrypted/wiki/Docker)

## Run Locally

[Local Installation Instructions](https://github.com/koush/scrypted/wiki/Local-Installation)

## Debug in VSCode

Follow the steps for running locally above to set up your environment, but stop short of `npm run`.

```sh
# switch to the server directory
cd scrypted/server
# open this directory in VSCode
code .
```

You can now launch Scrypted in VSCode.

## Plugin Development Documentation

https://developer.scrypted.app

## HomeKit Secure Video Setup

1. Install Scrypted
2. Open https://localhost:9443/
3. Install the HomeKit Plugin from the available plugins tab
4. Install the Unifi, HikVision, ONVIF, or Amcrest camera plugin
   * HKSV requires a plugin with hardware motion detect support. If there's no plugin for your camera, you can install the generic RTSP and the OpenCV motion detector plugin. This will use the processing power on your server to detect camera motion.
6. Install the Rebroadcast plugin.
    * This is optional but highly recommended. It keeps a short video loop of the stream in memory leading up to the motion.  
7. Pair with the Scrypted Server accessory using your HomeKit app on iOS or Mac.
8. Enable recording on the cameras in HomeKit.
    * Troubleshooting: Reload the HomeKit Plugin and/or restart Scrypted if streaming works, but recording events do not.
