# Scrypted Developer

## Getting Started

The quickest way to get started is to check out the the [Typescript sample](https://github.com/koush/scrypted-vscode-typescript) and open it in Visual Studio Code. The setup instructions can be found in the readme for the [project](https://github.com/koush/scrypted-vscode-typescript).

## Typescript Sample Setup

These instructions can be followed on your preferred development machine, and do not need to be run on the Scrypted Server itself. The Scrypted SDK can deploy and **debug** plugins running on a remote server. For example, the VS Code development environment can be running on a Mac, while the server is running on a Raspberry Pi.

1. npm install
2. Open this plugin director yin VS Code.
3. Edit `.vscode/settings.json` to point to the IP address of your Scrypted server. The default is `127.0.0.1`, your local machine.
4. Press Launch (green arrow button in the Run and Debug sidebar) to start debugging.
  * The VS Code `Terminal` area may show an authentication failure and prompt you to log in to the Scrypted Management Console with `npx scrypted login`. You will only need to do this once. You can then relaunch afterwards.
 
<p align="center">
    <img width="538" alt="image" src="https://user-images.githubusercontent.com/73924/151676616-c730eb56-26dd-466d-b7f5-25783300b3bc.png">
</p>
<br/>

## Creating a Switch

The aforementioned sample will create a single switch device.

```typescript
import axios from 'axios';
import { OnOff, ScryptedDeviceBase } from '@scrypted/sdk';

console.log('Hello World. This will create a virtual OnOff device.');
// OnOff is a simple binary switch. See "interfaces"  in package.json
// to add support for more capabilities, like Brightness or Lock.

class TypescriptLight extends ScryptedDeviceBase implements OnOff {
    constructor() {
        super();
        this.on = this.on || false;
    }
    async turnOff() {
        this.console.log('turnOff was called!');
        this.on = false;
    }
    async turnOn() {
        // set a breakpoint here.
        this.console.log('turnOn was called!');

        this.console.log("Let's pretend to perform a web request on an API that would turn on a light.");
        const ip = await axios.get('http://jsonip.com');
        this.console.log(`my ip: ${ip.data.ip}`);

        this.on = true;
    }
}

export default TypescriptLight;
```
<br/>
<br/>

# Core Concepts

Devices the core entry points and objects within Scrypted. A device can be a physical device, a virtual device, a provider of other devices (like a hub), a webhook, etc. Devices have two primary properties: Interfaces and Events.
<br/>

## Interfaces

Interfaces are how devices expose their capabilities to Scrypted. An OnOff interface represents a binary switch. The Brightness interface represents a light that can be dimmed. The ColorSettingRgb interface indicates the light can change color. A device may expose multiple different interfaces to describe its functionality.

For example, given the following devices, the interfaces they would implement:

Outlet: OnOff,
Dimmer Switch: OnOff, Brightness,
Color Bulb: OnOff, Brightness, ColorSettingRgb
Interfaces aren't only used represent characteristics of physical devices. As mentioned, they provide ways to hook into Scrypted. The HttpRequestHandler lets you add a web hook to handle incoming web requests. EventListener lets you create handlers that respond to events. DeviceProvider acts as a controller platform (like Hue or Lifx) for exposing multiple other devices to Scrypted.

Interfaces also provide a way to query the device state. Such as checking whether an outlet is on or off, the current brightness level, or the current color.

```typescript
// Interfaces describe how the current state of a device, and can be used to modify that state.
if (light.on) {
    light.turnOff();
}
else {
    light.turnOn();
}
```
<br/>

## Events

Scrypted maintains the state of all connected devices. Whenever the state of an interface is updated on a device, an Event will be triggered for that particular interface.

For example, when a light turns on, the Light device would send an OnOff event. If a Slack message is received, the Slack device would send a MessagingEndpoint event. Setting a schedule for sunrise on weekdays would send an Alarm event on that schedule.

Automations subscribe to these events in your smart home setup and react accordingly.

```
// Events are triggered by the device on update, and can be observed.
light.listen('OnOff', (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: object) => {
  if (eventData) {
    log.i('The light was turned on.');
  }
  else {
    log.i('The light was turned off.');
  }
});
```
<br/>
<br/>

# Creating Multiple Devices

Most plugins will want to create multiple devices. This is done by implementing the DeviceProvider interface.

To do this, thep project `package.json` needs to update the `scrypted` section that describes the plugin:

```json
"scrypted": {
    "name": "TypeScript Light Provider",
    "type": "DeviceProvider",
    "interfaces": [
        "DeviceProvider"
    ]
},
```

Then, the code is updated to support multiple lights:

```typescript
import axios from 'axios';
import sdk, { DeviceProvider, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';

class TypescriptLight extends ScryptedDeviceBase implements OnOff {
    constructor(nativeId?: string) {
        super(nativeId);
        this.on = this.on || false;
    }
    async turnOff() {
        this.console.log('turnOff was called!');
        this.on = false;
    }
    async turnOn() {
        // set a breakpoint here.
        this.console.log('turnOn was called!');

        this.console.log("Let's pretend to perform a web request on an API that would turn on a light.");
        const ip = await axios.get('http://jsonip.com');
        this.console.log(`my ip: ${ip.data.ip}`);

        this.on = true;
    }
}

class MyDeviceProvider extends ScryptedDeviceBase implements DeviceProvider {
    constructor(nativeId?: string) {
        super(nativeId);

        this.prepareDevices();
    }

    async prepareDevices() {
        // "Discover" the lights provided by this provider to Scrypted.
        await sdk.deviceManager.onDevicesChanged({
            devices: [
                {
                    // the native id is the unique identifier for this light within
                    // your plugin.
                    nativeId: 'light1',
                    name: 'Light 1',
                    type: ScryptedDeviceType.Light,
                    interfaces: [
                        ScryptedInterface.OnOff,
                    ]
                },
                {
                    nativeId: 'light2',
                    name: 'Light 1',
                    type: ScryptedDeviceType.Light,
                    interfaces: [
                        ScryptedInterface.OnOff,
                    ]
                }
            ]
        });
    }

    // After the lights are discovered, Scrypted will request the plugin create the
    // instance that can be used to control and query the light.
    getDevice(nativeId: string) {
        return new TypescriptLight(nativeId);
    }
}

// Export the provider from the plugin, rather than the individual light.
export default MyDeviceProvider;
```

Running the sample will then create 3 devices: the plugin/hub and the 2 lights it controls.
