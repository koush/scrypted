# Tuya for Scrypted

This is a Tuya controller that integrates Tuya devices, specifically cameras, into Scrypted.

The plugin will discover all the cameras within Tuya Cloud IoT project and report them to Scrypted, including motion events, for the ones that are supported.

## Retrieving Keys
In order to retrieve `Access Id` and `Access Key`, you must follow the guide below:
- [Using Smart Home PaaS (TuyaSmart, SmartLife, ect...)](https://developer.tuya.com/en/docs/iot/Platform_Configuration_smarthome?id=Kamcgamwoevrx&_source=6435717a3be1bc67fdd1f6699a1a59ac)

- [If you're using custom development](https://developer.tuya.com/en/docs/iot/Configuration_Guide_custom?id=Kamcfx6g5uyot&_source=bdc927ff355af92156074d47e00d6191)

Once you have retreived both the `Access Id` and `Access Key` from the project, you can get the `User Id` by going to Tuya Cloud IoT -> Select the Project -> Devices -> Link Tuya App Account -> and then get the UID.

## TODOs
- Fix 2-way talk for supported platforms (Can only work with WebRTC since we only get one stream with RTSPS)
- Add support for camera doorbells (Just need to implement doorbell notification)