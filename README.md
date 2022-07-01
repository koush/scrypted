# Scrypted Home Automation

Scrypted is a home automation platform primarily focusing on making camera experiences seamless.
 * Video load instantly, everywhere: [Demo](https://www.reddit.com/r/homebridge/comments/r34k6b/if_youre_using_homebridge_for_cameras_ditch_it/)
 * [HomeKit Secure Video Support](https://github.com/koush/scrypted/wiki/HomeKit-Secure-Video-Setup)
 * Google Home support: "Ok Google, Stream Backyard"
 * Alexa Support: Streaming to Alexa app on iOS/Android and Echo Show.

<img width="400" alt="Scrypted_Management_Console" src="https://user-images.githubusercontent.com/73924/131903488-722d87ac-a0b0-40fe-b605-326e6b886e35.png">

# Installation

Select the appropriate guide. After installation is finished, remember to visit [HomeKit Secure Video Setup](https://github.com/koush/scrypted/wiki/HomeKit-Secure-Video-Setup).

 * [Raspberry Pi](https://github.com/koush/scrypted/wiki/Installation:-Raspberry-Pi)
 * Linux
   * [Docker](https://github.com/koush/scrypted/wiki/Installation:-Docker-Linux) - This is the recommended method. Local installation may interfere with other software, like Homebridge, Home Assistant, or HOOBS.
   * [Docker Compose](https://github.com/koush/scrypted/wiki/Installation:-Docker-Compose)
   * [Local Installation](https://github.com/koush/scrypted/wiki/Installation:-Linux) - Use this if Docker scares you or whatever.
 * Mac
   * [Local Installation](https://github.com/koush/scrypted/wiki/Installation:-Mac)
<!--    * Docker Desktop is [not supported](https://github.com/koush/scrypted/wiki/Installation:-Docker-Desktop). -->
 * Windows
   * [Local Installation](https://github.com/koush/scrypted/wiki/Installation:-Windows)
   * [WSL2 Installation](https://github.com/koush/scrypted/wiki/Installation:-WSL2-Windows)
<!--    * Docker Desktop is [not supported](https://github.com/koush/scrypted/wiki/Installation:-Docker-Desktop). -->
 * [ReadyNAS: Docker](https://github.com/koush/scrypted/wiki/Installation:-Docker-ReadyNAS)
 * [Synology: Docker](https://github.com/koush/scrypted/wiki/Installation:-Docker-Synology-NAS)
 * [QNAP: Docker](https://github.com/koush/scrypted/wiki/Installation:-Docker-QNAP-NAS)
 * [Unraid: Docker](https://github.com/koush/scrypted/wiki/Installation:-Docker-Unraid)
 
## Discord

Chat on Discord for support, tips, announcements, and bug reporting. There is an active and helpful community.

[Join Scrypted Discord](https://discord.gg/DcFzmBHYGq)

## Wiki

There are many topics covered in the [Scrypted Wiki](https://github.com/koush/scrypted/wiki) sidebar. Review them for documented support, tips, and guides before asking for assistance on GitHub or Discord.

## Supported Platforms

 * Google Home
 * Apple HomeKit
 * Amazon Alexa

Supported accessories: 
 * https://github.com/koush/scrypted/tree/main/plugins


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
# check out the code
git clone https://github.com/koush/scrypted
cd scrypted
# get the dependencies for the server and various plugins
./npm-install.sh
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

