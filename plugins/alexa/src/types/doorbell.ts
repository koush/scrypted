import sdk, { ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { addSupportedType } from "./common";

const { mediaManager } = sdk;

addSupportedType(ScryptedDeviceType.Doorbell, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.VideoCamera))
            return;

        return {
            displayCategories: ['DOORBELL'],
            capabilities: [
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.RTCSessionController",
                    "version": "3",
                    "configuration": {
                        "isFullDuplexAudioSupported": false,
                    }
                },
            ],
        }
    }
});
