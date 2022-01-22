# Scrypted Home Automation

Scrypted is a home automation platform primarily focusing on making camera experiences seamless.
 * Streams load instantly, everywhere: [Demo](https://www.reddit.com/r/homebridge/comments/r34k6b/if_youre_using_homebridge_for_cameras_ditch_it/)
 * [HomeKit Secure Video Support](#homekit-secure-video-setup)
 * Google Home support: "Ok Google, Stream Backyard"

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

## Development

## Debug the Scrypted Server in VSCode

```sh
# check out the code
git clone https://github.com/koush/scrypted
cd scrypted
# get the dependencies for the server and various plugins
./npm-install.sh
# open server project in VS Code
code server
```

You can now launch Scrypted in VSCode.

## Debug Scrypted Plugins in VSCode

```sh
# this is an example for homekit.
# follow the steps above to set up the checkout.
# open the homekit project in VS Code
code plugins/homekit
```

You can now launch (using the Start Debugging play button) the HomeKit Plugin in VSCode. Please be aware that you do *not* need to restart the Scrypted Server if you make changes to a plugin. Edit the plugin, launch, and the updated plugin will deploy on the running server.

If you do not want to set up VS Code, you can also run build and install the plugin directly from the command line:

```sh
# currently in the plugins/homekit directory.
npm run scrypted-webpack && npm run scrypted-deploy 127.0.0.1
```

## Plugin Development

Want to write your own plugin? Full documentation is available here: https://developer.scrypted.app


## HomeKit Secure Video Setup

1. Install Scrypted.
2. Open https://localhost:10443/ (substitute localhost appropriately for a remote server).
3. Install the appropriate plugin for your camera. Using the manufacturer plugin, when available, is recommended. Many manufacturers also whitelabel their products under different brands. For example, Dahua and Amcrest are the same manufacturer, and you can use the Amcrest plugin for both cameras. If your camera does not have a dedicated plugin, check if it is ONVIF compatible (a standard camera protocol), and try that. If no dedicated plugin is available, use the RTSP or FFmpeg plugin.
   * HKSV requires cameras with motion alerts, and these plugins provide motion alerts.
   * If there's no plugin for your camera, but it supports motion alerts using mail, use the generic RTSP, SMTP plugin, and Dummy Switch plugin to create a motion sensor. Link this mail motion sensor to the camera's HomeKit settings within Scrypted.
   * If there's no plugin *or* mail support for your camera, you can install the generic RTSP Plugin, Video Analysis Plugin and a motion detection plugin. This will use the processing power on your server to detect camera motion. The following motion detection plugins are available:
     * OpenCV (Higher memory and CPU usage, better results)
     * PAM Diff
4. Install the HomeKit Plugin.
5. Install the Rebroadcast plugin.
    * This is optional but highly recommended. It keeps a short video loop of the stream in memory leading up to the motion.  
6. Pair with the Scrypted Server accessory using your HomeKit app on iOS or Mac.
7. Enable recording on the cameras in HomeKit.
