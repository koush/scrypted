# Tuya for Scrypted

This is a Tuya controller that integrates Tuya devices, specifically cameras, into Scrypted.

The plugin will discover all the cameras within Tuya Cloud IoT project and report them to Scrypted, including motion events, for the ones that are supported.

## Retrieving Keys
In order to retrieve `Access Id` and `Access Key`, you must follow the guide below:
- [Using Smart Home PaaS (TuyaSmart, SmartLife, ect...)](https://developer.tuya.com/en/docs/iot/Platform_Configuration_smarthome?id=Kamcgamwoevrx&_source=6435717a3be1bc67fdd1f6699a1a59ac)

Follow this [guide](https://developer.tuya.com/en/docs/iot/Configuration_Guide_custom?id=Kamcfx6g5uyot&_source=bdc927ff355af92156074d47e00d6191)

Once you have retreived both the `Access Id` and `Access Key` from the project, you can get the `User Id` by going to Tuya Cloud IoT -> Select the Project -> Devices -> Link Tuya App Account -> and then get the UID.

## npm commands
- npm run scrypted-webpack
- npm run scrypted-deploy
- npm run scrypted-debug

## scrypted distribution via npm
1. Ensure package.json is set up properly for publishing on npm. 
2. npm publish

## Visual Studio Code configuration
- If using a remote server, edit .vscode/settings.json to specify the IP Address of the Scrypted server.
- Launch Scrypted Debugger from the launch menu.
