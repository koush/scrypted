import { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { getCameraCapabilities } from "./camera";
import { addSupportedType, EventReport } from "./common";

addSupportedType(ScryptedDeviceType.Doorbell, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.RTCSignalingChannel) || !device.interfaces.includes(ScryptedInterface.BinarySensor))
            return;

        const capabilities = getCameraCapabilities(device);
        capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa.DoorbellEventSource",
                "version": "3",
                "proactivelyReported": true
            } as any,
        );

        return {
            displayCategories: ['CAMERA'],
            capabilities,
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
