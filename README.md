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

# Installation

## Checkout from Source

## Run on Docker

```sh
# checkout source
git clone https://github.com/koush/scrypted.git
cd scrypted
```

```sh
# build image from current checkout
sudo docker build -t scrypted .
# run it
sudo docker run --network host -v $(pwd)/server/scrypted.db:/server/scrypted.db scrypted
```

## Run Locally for Development

### Prerequisites

* Node v16 (older versions seem to have issues with the cluster module)
* ffmpeg in $PATH/%PATH%
* Windows is not supported, but may work.

### Linux Prerequisites

```sh
sudo apt install libavahi-compat-libdnssd-dev
```

### Run

```sh
# checkout source
git clone https://github.com/koush/scrypted.git
cd scrypted
```

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

