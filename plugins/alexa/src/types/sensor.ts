import { EntrySensor, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, Thermometer } from "@scrypted/sdk";
import { DiscoveryEndpoint, DiscoveryCapability, ChangeReport, Report, StateReport, DisplayCategory, ChangePayload, Property } from "../alexa";
import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Sensor, {
  async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
        const capabilities: DiscoveryCapability[] = [];
        const displayCategories: DisplayCategory[] = [];

        if (device.interfaces.includes(ScryptedInterface.Thermometer)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.TemperatureSensor",
                    "version": "3",
                    "properties": {
                      "supported": [
                        {
                          "name": "temperature"
                        }
                      ],
                      "proactivelyReported": true,
                      "retrievable": true
                    }
                } as DiscoveryCapability
            );

            displayCategories.push('TEMPERATURE_SENSOR');
        }

        if (device.interfaces.includes(ScryptedInterface.EntrySensor)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.ContactSensor",
                    "version": "3",
                    "properties": {
                        "supported": [
                            {
                                "name": "detectionState"
                            }
                        ],
                        "proactivelyReported": true,
                        "retrievable": true
                    }
                } as DiscoveryCapability
            );

            displayCategories.push('CONTACT_SENSOR');
        }

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.MotionSensor",
                    "version": "3",
                    "properties": {
                        "supported": [
                            {
                                "name": "detectionState"
                            }
                        ],
                        "proactivelyReported": true,
                        "retrievable": true
                    }
                } as DiscoveryCapability
            );

            displayCategories.push('MOTION_SENSOR');
        }

        if (capabilities.length === 0)
            return;

        return {
            displayCategories: displayCategories,
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & MotionSensor & EntrySensor & Thermometer): Promise<Partial<Report>> {
        let data = {
            context: {
                properties: []
            }
            
        } as Partial<StateReport>;
    
        if (eventSource.interfaces.includes(ScryptedInterface.Thermometer)) {
            data.context.properties.push({
                "namespace": "Alexa.TemperatureSensor",
                "name": "temperature",
                "value": {
                  "value": eventSource.temperature,
                  "scale": "CELSIUS"
                },
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }

        if (eventSource.interfaces.includes(ScryptedInterface.EntrySensor)) {
            data.context.properties.push({
                "namespace": "Alexa.ContactSensor",
                "name": "detectionState",
                "value": eventSource.entryOpen ? "DETECTED" : "NOT_DETECTED",
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }
    
        if (eventSource.interfaces.includes(ScryptedInterface.MotionSensor)) {
            data.context.properties.push({
                "namespace": "Alexa.MotionSensor",
                "name": "detectionState",
                "value": eventSource.motionDetected ? "DETECTED" : "NOT_DETECTED",
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }
    
        return data;
    },
    async sendEvent(eventSource: ScryptedDevice & MotionSensor & EntrySensor & Thermometer, eventDetails, eventData): Promise<Partial<Report>> {      
        if (eventDetails.eventInterface === ScryptedInterface.MotionSensor)
            return {
                event: {
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
                                    "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                }
            } as Partial<ChangeReport>;

        if (eventDetails.eventInterface === ScryptedInterface.EntrySensor)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.ContactSensor",
                                    "name": "detectionState",
                                    "value": eventData ? "DETECTED" : "NOT_DETECTED",
                                    "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                }
            } as Partial<ChangeReport>;

            if (eventDetails.eventInterface === ScryptedInterface.Thermometer)
                return {
                    event: {
                        payload: {
                            change: {
                                cause: {
                                    type: "PERIODIC_POLL"
                                },
                                properties: [
                                    {
                                        "namespace": "Alexa.TemperatureSensor",
                                        "name": "temperature",
                                        "value": {
                                            "value": eventSource.temperature,
                                            "scale": "CELSIUS"
                                          },
                                        "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                        "uncertaintyInMilliseconds": 0
                                    } as Property
                                ]
                            }
                        } as ChangePayload,
                    }
                } as Partial<ChangeReport>;

        return undefined;
    }
});
