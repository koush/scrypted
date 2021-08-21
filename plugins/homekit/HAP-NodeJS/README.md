<span align="center">
  
# HAP-NodeJS
  
  <a href="https://www.npmjs.com/package/hap-nodejs"><img title="npm version" src="https://badgen.net/npm/v/hap-nodejs" ></a>
  <a href="https://www.npmjs.com/package/hap-nodejs/v/beta"><img title="npm version beta" src="https://badgen.net/npm/v/hap-nodejs/beta" ></a>
  <a href="https://www.npmjs.com/package/hap-nodejs"><img title="npm downloads" src="https://badgen.net/npm/dt/hap-nodejs" ></a>
  <a href="https://github.com/KhaosT/HAP-NodeJS/actions?query=workflow%3A%22Node-CI%22"><img title="node ci" src="https://github.com/homebridge/HAP-NodeJS/workflows/Node-CI/badge.svg" ></a>

</span>

HAP-NodeJS is an implementation of the HomeKit Accessory Server as specified in the HomeKit Accessory Protocol (HAP),
which is defined by Apple as part of the HomeKit Framework.

HAP-NodeJS is intended to be used as a library to easily create your own HomeKit Accessory on a Raspberry Pi,
Intel Edison, or any other platform that can run Node.js :)  
If you are searching for a pluggable HomeKit bridge with over a thousand community driven plugins to bring HomeKit
support to devices which do not support HomeKit out of the box, you may want to look at the 
[homebridge][project-homebridge] project (which also uses HAP-NodeJS internally).

The implementation tries to follow the HAP specification as close as it can, but may differ in some cases.
HAP-NodeJS is not an Apple certified HAP implementation, as this is only available to members of the MFi program.

## Getting started

You may start by having a look at our [Wiki][wiki], especially have a look at the 
[Important HomeKit Terminology][hk-terminology] used in this project.

There is also a pretty detailed guide on [how to start developing with HAP-NodeJS][dev-guide].
Or you may just have a look at our [examples][examples-repo] repository
(or some of the old [accessory examples][example-accessories]).

The documentation (WIP) can be found [here](https://developers.homebridge.io/HAP-NodeJS/modules.html).

See the FAQ on how to enable [debug output][faq-debug] for HAP-NodeJS.

If you wish to do a contribution please read through our [CONTRIBUTING][contributing] guide.

## Projects based on HAP-NodeJS

- [Homebridge][project-homebridge] - HomeKit support for the impatient - Pluggable HomeKit Bridge.  
    Plugins available for  e.g. Pilight, Telldus TDtool, Savant, Netatmo, Open Pixel Control, HomeWizard, Fritz!Box, 
    LG WebOS TV, Home Assistant, HomeMatic and many more.
- [OpenHAB-HomeKit-Bridge][project-openhab-homekit-bridge] - OpenHAB HomeKit Bridge bridges openHAB items to 
    Apples HomeKit Accessory Protocol.
- [homekit2mqtt][project-homekit2mqtt] - HomeKit to MQTT bridge.
- [pimatic-hap][project-pimatic-hap] - Pimatic homekit bridge.
- [node-red-contrib-homekit][project-node-red-contrib-homekit] - Node-RED nodes to simulate Apple HomeKit devices.
- [ioBroker.homekit][project-ioBroker-homekit] - connect ioBroker to HomeKit.
- [AccessoryServer][project-accessoryserver] - HomeKit integration for IR/RF/IP-devices

## Notes

Special thanks to [Alex Skalozub][link-alex-skalozub], who reverse-engineeredthe server side HAP.
~~You can find his research [here][link-homekit-research].~~
(Sadly, on Nov 4, Apple sent the [DMCA][link-apple-dmca] request to Github to remove the research.)

[There](http://instagram.com/p/t4cPlcDksQ/) is a video demo running this project on Intel Edison.

If you are interested in HAP over BTLE, you might want to check [this][link-hap-over-btle].

<!-- links -->

[wiki]: https://github.com/homebridge/HAP-NodeJS/wiki
[hk-terminology]: https://github.com/homebridge/HAP-NodeJS/wiki/HomeKit-Terminology
[dev-guide]: https://github.com/homebridge/HAP-NodeJS/wiki/Using-HAP-NodeJS-as-a-library
[faq-debug]: https://github.com/homebridge/HAP-NodeJS/wiki/FAQ#debug-mode
[contributing]: https://github.com/homebridge/HAP-NodeJS/blob/master/CONTRIBUTING.md

[examples-repo]: https://github.com/homebridge/HAP-NodeJS-examples
[example-accessories]: https://github.com/homebridge/HAP-NodeJS/tree/master/src/accessories

[project-homebridge]: https://github.com/homebridge/homebridge
[project-openhab-homekit-bridge]: https://github.com/htreu/OpenHAB-HomeKit-Bridge
[project-homekit2mqtt]: https://github.com/hobbyquaker/homekit2mqtt
[project-pimatic-hap]: https://github.com/michbeck100/pimatic-hap
[project-node-red-contrib-homekit]: https://github.com/NRCHKB/node-red-contrib-homekit-bridged
[project-ioBroker-homekit]: https://github.com/ioBroker/ioBroker.homekit2
[project-accessoryserver]: https://github.com/Appyx/AccessoryServer

[link-alex-skalozub]: https://twitter.com/pieceofsummer
[link-homekit-research]: https://gist.github.com/pieceofsummer/13272bf76ac1d6b58a30
[link-apple-dmca]: https://github.com/github/dmca/blob/master/2014/2014-11-04-Apple.md
[link-hap-over-btle]: https://gist.github.com/KhaosT/6ff09ba71d306d4c1079
