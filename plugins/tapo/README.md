# Tapo Camera Plugin

This plugin adds two way audio support for Tapo cameras. This plugin does not import cameras into Scrypted. Use the ONVIF plugin to import Tapo cameras, and then use this plugin to add two way audio support.

## Tapo Setup


1. Open the Tapo app on iOS/Android.
2. Click `Me` in the bottom bar.
3. Click `Tapo Lab`.
4. Enable Third Party Compatibility.

## Scrypted Setup

1. Add the Tapo Camera using the ONVIF Plugin. The ONVIF password can be found in the camera's settings in the Tapo app: Settings -> Advanced Settings -> Camera Account -> Account Information.
2. Enable ONVIF Two Way Audio on the camera.
3. Enable the Tapo Two Way Audio extension.
4. Enter your Tapo Cloud password into the Tapo Two Way Audio Settings. This is not the same as the ONVIF password.
