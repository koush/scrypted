# Scrypted

Scrypted is a high performance home video integration platform and NVR with smart detections. [Instant, low latency, streaming](https://streamable.com/xbxn7z) to HomeKit, Google Home, and Alexa. Supports most cameras. [Learn more](https://docs.scrypted.app).

<img src="https://github.com/koush/scrypted/assets/73924/57e1d556-cd3d-4448-81f9-a6c51b6513de">

## Installation and Documentation

Installation and camera onboarding instructions can be found in the [docs](https://docs.scrypted.app).

## Community

Scrypted has active communities on [Discord](https://discord.gg/DcFzmBHYGq), [Reddit](https://reddit.com/r/scrypted), and [Github](https://github.com/koush/scrypted). Check them out if you have questions!

## Development

## Debug Scrypted Plugins in VS Code

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

You can now launch (using the Start Debugging play button) the HomeKit Plugin in VS Code. Please be aware that you do *not* need to restart the Scrypted Server if you make changes to a plugin. Edit the plugin, launch, and the updated plugin will deploy on the running server.

If you do not want to set up VS Code, you can also run build and install the plugin directly from the command line:

```sh
# currently in the plugins/homekit directory.
npm run build && npm run scrypted-deploy 127.0.0.1
```

### Plugin SDK Documentation

Want to write your own plugin? Full documentation is available here: https://developer.scrypted.app


## Debug the Scrypted Server in VS Code

Debugging the server should not be necessary, as the server only provides the hosting and RPC mechanism for plugins. The following is for reference purpose. Most development can be done by debugging the relevant plugin.

```sh
# check out the code
git clone https://github.com/koush/scrypted
cd scrypted
# get the dependencies for the server and various plugins
./npm-install.sh
# open server project in VS Code
code server
```

You can now launch the Scrypted Server in VS Code.
