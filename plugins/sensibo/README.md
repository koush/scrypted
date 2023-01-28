# Sensibo plugin for Scrypted

This plugin adds support for Sensibo devices to Scrypted, using the Sensibo cloud API. The 'Climate React' system is optionally supported and is used to implement the 'HeatCool' thermostat mode, which automatically adjusts the air conditioner settingsto keep temperatures fixed within a specific temperature range.

In order to use this plugin, an API key must be obtained from 'https://home.sensibo.com/me/api' for the account to which the Sensibo device is registered.

# Build Instructions

1. npm install
2. Open this plugin director yin VS Code.
3. Edit `.vscode/settings.json` to point to the IP address of your Scrypted server. The default is `127.0.0.1`, your local machine.
4. Press Launch (green arrow button in the Run and Debug sidebar) to start debugging.
  * The VS Code `Terminal` area may show an authentication failure and prompt you to log in to the Scrypted Management Console with `npx scrypted login`. You will only need to do this once. You can then relaunch afterwards.
 
<img width="538" alt="image" src="https://user-images.githubusercontent.com/73924/151676616-c730eb56-26dd-466d-b7f5-25783300b3bc.png">
