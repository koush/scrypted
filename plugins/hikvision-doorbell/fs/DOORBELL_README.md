# Hikvision Doorbell

**⚠️ Important: Version 2.x Breaking Changes**

Version 2 of this plugin is **not compatible** with version 1.x. Before installing or upgrading to version 2:
- **Option 1**: Completely remove the old plugin from Scrypted
- **Option 2**: Delete all devices that belong to the old plugin

After removing the old version, you will need to reconfigure all doorbell devices from scratch.

## Introduction

At the moment, plugin was tested with the **DS-KV6113-PE1(C)** model `doorbell` with firmware version: **V3.7.0 build 250818**, in the following modes:

- the `doorbell` is connected to the `Hik-Connect` service;
- the `doorbell` is connected to a fake SIP proxy, which this plugin runs.

## Settings

### Support door lock opening

The doorbell can control electromechanical locks connected to it. To enable lock control in Scrypted, go to the doorbell device settings, navigate to **Advanced Settings**, and select **Locks** in the **Provided devices** option.

This will create dependent lock device(s) with the `Lock` type. The plugin automatically detects how many doors the doorbell supports (typically 1, but some models support multiple doors). If multiple doors are supported, each lock device will be named with its door number (e.g., "Door Lock 1", "Door Lock 2"). 

Lock devices are automatically removed when the parent doorbell device is deleted.

### Support contact sensors

Door open/close status monitoring is available through contact sensors. To enable this functionality in Scrypted, go to the doorbell device settings, navigate to **Advanced Settings**, and select **Contact Sensors** in the **Provided devices** option.

This will create dependent contact sensor device(s) with the `BinarySensor` type. The plugin automatically detects how many doors the doorbell supports (typically 1, but some models support multiple doors). If multiple doors are supported, each contact sensor will be named with its door number (e.g., "Contact Sensor 1", "Contact Sensor 2").

Contact sensor devices are automatically removed when the parent doorbell device is deleted.

### Support tamper alert

For security, the doorbell includes a built-in tamper detection sensor. To enable tamper alert monitoring in Scrypted, go to the doorbell device settings, navigate to **Advanced Settings**, and select **Tamper Alert** in the **Provided devices** option. If you don't enable this option, tamper alert signals will be interpreted as `Motion Detection` events.

This will create a dependent tamper alert device with the `BinarySensor` type. When the doorbell's tamper sensor is triggered, the device will turn **on**. You can manually turn it **off** in the Scrypted web interface. 

The tamper alert device is automatically removed when the parent doorbell device is deleted.

### Setting up a receiving call (the ability to ringing)

In order for the `doorbell` to make a call, it must be configured accordingly, and this plugin device must also be configured to receive calls from the doorbell.

The interaction mode is configured using the **SIP Mode** combobox. The plugin supports three modes of receiving calls, description below.

#### Don't Use SIP

This mode should be used if you have an **Indoor Station** and a `doorbell` connected to it.

You should also enable the **Hik-Connect** (Platform Access Mode) in the `doorbell` settings so that `this device` receives a call notification. These are the implementation features of the doorbell software, unfortunately.

#### Connect to SIP Proxy

This mode should be used when you have a separate SIP gateway and all your intercom devices work via SIP telephony.

**On this device** you need to configure a connection to your SIP proxy (gateway) in the additional tab, which will appear after saving the selection.

**On `doorbell`** also set up a connection to a SIP proxy (gateway), and also, in the appropriate section of the settings, specify the “phone number” of this device so that a call will also be received here.

#### Emulate SIP Proxy

This mode should be used when you have a `doorbell` but no **Indoor Station**, and you want to connect the `doorbell` directly to the Scrypted server.

In this mode, the plugin creates a fake SIP proxy that listens for connections on the specified port (or auto-selects a port if left blank). This server receives call notifications and, when intercom starts (two-way audio), simulates picking up the handset so the `doorbell` switches to conversation mode (stops ringing).

**Important**: When you enable this mode, the plugin **automatically configures the doorbell** with the necessary SIP settings. You don't need to configure the doorbell manually.

On the additional settings tab, you can configure:
- **Port**: The listening port for the fake SIP proxy (leave blank for automatic selection)
- **Room Number**: Virtual room number (1-9999) that represents this fake SIP proxy
- **SIP Proxy Phone Number**: Phone number representing the fake SIP proxy (default: 10102)
- **Doorbell Phone Number**: Phone number representing the doorbell (default: 10101)
- **Button Number**: Call button number for doorbells with multiple buttons (1-99, default: 1)

The plugin automatically applies these settings to the doorbell device via ISAPI. If the doorbell is temporarily unreachable, the plugin will retry the configuration automatically.
