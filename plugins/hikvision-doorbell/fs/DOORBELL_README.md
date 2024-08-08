# Hikvision Doorbell

At the moment, plugin was tested with the **DS-KV6113PE1[C]** model `doorbell` with firmware version: **V2.2.65 build 231213**, in the following modes:

- the `doorbell` is connected to the `Hik-Connect` service;
- the `doorbell` is connected to a local SIP proxy (asterisk);
- the `doorbell` is connected to a fake SIP proxy, which this plugin runs.

## Settings

### Support door lock opening

Most of these doorbells have the ability to control an electromechanical lock. To implement the lock controller software interface in Scrypted, you need to create a separate device with the `Lock` type. Such a device is created automatically if you enable the **Expose Door Lock Controller** checkbox.

The lock controller is linked to this device (doorbell). Therefore, when the doorbell is deleted, the associated lock controller will also be deleted.

### Support tamper alert

Most of a doorbells have a tamper alert. To implement the tamper alert software interface in Scrypted, you need to create a separate device with the `Switch` type. Such a device is created automatically if you enable the **Expose Tamper Alert Controller** checkbox. If you leave this checkbox disabled, the tamper signal will be interpreted as a `Motion Detection` event.

If the tamper on the doorbell is triggered, the controller (`Switch`) will **turn on**. You can **turn off** the switch manually in the Scrypted web interface only.

The tamper alert controller is linked to this device (doorbell). Therefore, when the doorbell is deleted, the associated tamper alert controller will also be deleted.

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

This mode should be used when you have a `doorbell` but no **Indoor Station**, and you want to connect this `doorbell` to Scrypted server only.

In this mode, the plugin creates a fake SIP proxy that listens for a connection on the specified port (or auto-select a port if not specified). The task of this server is to receive a notification about a call and, in the event of an intercom start (two way audio), simulate picking up the handset so that the `doorbell` switches to conversation mode (stops ringing).

On the additional tab, configure the desired port, and you can also enable the **Autoinstall Fake SIP Proxy** checkbox, for not to configure `doorbell` manually.

In the `doorbell` settings you can configure the connection to the fake SIP proxy manually. You should specify the IP address of the Scrypted server and the port of the fake proxy. The contents of the other fields do not matter, since the SIP proxy authorizes the “*client*” using the known doorbell’s IP address.
