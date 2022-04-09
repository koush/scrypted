import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { addSupportedType, EventReport } from "./common";

addSupportedType(ScryptedDeviceType.Doorbell, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.RTCSignalingChannel) || !device.interfaces.includes(ScryptedInterface.BinarySensor))
            return;

        return {
            displayCategories: ['CAMERA'],
            capabilities: [
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.RTCSessionController",
                    "version": "3",
                    "configuration": {
                        isFullDuplexAudioSupported: true,
                    }
                },
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.DoorbellEventSource",
                    "version": "3",
                    "proactivelyReported": true
                }
            ],
        }
    },
    async reportState(eventSource: ScryptedDevice & BinarySensor, eventDetails, eventData): Promise<EventReport> {
        if (!eventSource.binaryState)
            return undefined;
        return {
            type: 'event',
            namespace: 'Alexa.DoorbellEventSource',
            name: 'DoorbellPress',
            payload: {
                "cause": {
                    "type": "PHYSICAL_INTERACTION"
                },
                "timestamp": new Date().toISOString(),
            }
        };
    }
});
