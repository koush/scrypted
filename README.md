# Scrypted Home Automation

<img width="1460" alt="Scrypted_Management_Console" src="https://user-images.githubusercontent.com/73924/131903488-722d87ac-a0b0-40fe-b605-326e6b886e35.png">

## Supported Platforms

 * Google Home
 * Apple HomeKit
 * Amazon Alexa

Supported accessories: 
 * https://github.com/koush/scrypted/tree/main/plugins

## Installation


```sh
git clone https://github.com/koush/scrypted.git
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

