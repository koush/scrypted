# Scrypted Home Automation

<img width="1460" alt="Scrypted_Management_Console" src="https://user-images.githubusercontent.com/73924/131903488-722d87ac-a0b0-40fe-b605-326e6b886e35.png">

## Discord

https://discord.gg/DcFzmBHYGq

## Supported Platforms

 * Google Home
 * Apple HomeKit
 * Amazon Alexa

Supported accessories: 
 * https://github.com/koush/scrypted/tree/main/plugins

## Installation

### Prerequisites

* Node v16 (or v14)
* ffmpeg in $PATH/%PATH%

### Linux Prerequisites
```sh
sudo apt install libavahi-compat-libdnssd-dev
```

### Windows Prerequisites


On Windows you are going to need Apples "Bonjour SDK for Windows". You can download it either from [Apple](https://developer.apple.com/download/more/?=Bonjour%20SDK%20for%20Windows) (registration required) or various unofficial sources. Take your pick. After installing the SDK restart your computer and make sure the `BONJOUR_SDK_HOME` environment variable is set. You'll also need a compiler. Microsoft Visual Studio Express will do. On Windows node >=0.7.9 is required.


### Checkout from Source

```sh
git clone https://github.com/koush/scrypted.git
```

### Run

```sh
cd scrypted/server
npm install
npm run serve
# visit https://localhost:9443/ in a browser
```

## Plugin Development Documentation

https://developer.scrypted.app

## HomeKit Secure Video Setup

1. Install Scrypted
2. Open https://localhost:9443/
3. Install the HomeKit Plugin from the available plugins tab
4. Install the Unifi or Amcrest camera plugin
5. (optional/recommended) Install the Prebuffer plugin to keep a short video loop of the stream leading up to the motion.
6. Pair with the Scrypted Hub accessory using your HomeKit app on iOS or Mac.

