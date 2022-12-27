import { BinarySensor, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { getCameraCapabilities } from "./camera";
import { addSupportedType, EventReport, StateReport } from "./common";
import { DisplayCategory } from "alexa-smarthome-ts";

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
            capabilities
        }
    },
    async reportState(device: ScryptedDevice & MotionSensor): Promise<StateReport>{
        return {
            type: 'state',
            namespace: 'Alexa',
            name: 'StateReport',
            context: {
                "properties": [
                    {
                        "namespace": "Alexa.MotionSensor",
                        "name": "detectionState",
                        "value": device.motionDetected ? "DETECTED" : "NOT_DETECTED",
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    }
                ]
            }
        };
    },
    async sendEvent(eventSource: ScryptedDevice, eventDetails, eventData): Promise<EventReport> {
        if (eventDetails.eventInterface === ScryptedInterface.MotionSensor)
            return {
                type: 'event',
                namespace: 'Alexa',
                name: 'ChangeReport',
                payload: {
                    change: {
                        cause: {
                            type: "PHYSICAL_INTERACTION"
                        },
                        properties: [
                            {
                                "namespace": "Alexa.MotionSensor",
                                "name": "detectionState",
                                "value": eventData ? "DETECTED" : "NOT_DETECTED",
                                "timeOfSample": new Date().toISOString(),
                                "uncertaintyInMilliseconds": 0
                            }
                        ]
                    }
                },
            };
        
        if (eventDetails.eventInterface === ScryptedInterface.BinarySensor && eventData === true)
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
