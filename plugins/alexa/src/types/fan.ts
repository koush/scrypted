import { Fan, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { DiscoveryEndpoint, ChangeReport, Report, Property, ChangePayload, DiscoveryCapability, StateReport } from "../alexa";
import { supportedTypes } from ".";

// Alexa models the fan speed as a 0-100 percentage range, matching the convention used by the
// HomeKit plugin. The actual device speed is derived from the device's maxSpeed.
export function fanSpeedToRangeValue(device: ScryptedDevice & Fan): number {
    const speed = device.fan?.speed;
    if (!speed)
        return 0;
    const maxSpeed = device.fan?.maxSpeed;
    if (!maxSpeed)
        return 100;
    return Math.abs(Math.round(speed / maxSpeed * 100));
}

export function rangeValueToFanSpeed(device: ScryptedDevice & Fan, rangeValue: number): number {
    const maxSpeed = device.fan?.maxSpeed;
    return maxSpeed
        ? Math.round(rangeValue / 100 * maxSpeed)
        : (rangeValue ? 1 : 0);
}

supportedTypes.set(ScryptedDeviceType.Fan, {
    async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
        if (!device.interfaces.includes(ScryptedInterface.OnOff) && !device.interfaces.includes(ScryptedInterface.Fan))
            return;

        const capabilities: DiscoveryCapability[] = [];

        if (device.interfaces.includes(ScryptedInterface.OnOff)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.PowerController",
                "version": "3",
                "properties": {
                    "supported": [
                        {
                            "name": "powerState"
                        }
                    ],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            });
        }

        if (device.interfaces.includes(ScryptedInterface.Fan)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.RangeController",
                "instance": "Fan.Speed",
                "version": "3",
                "properties": {
                    "supported": [
                        {
                            "name": "rangeValue"
                        }
                    ],
                    "proactivelyReported": true,
                    "retrievable": true
                },
                "capabilityResources": {
                    "friendlyNames": [
                        {
                            "@type": "asset",
                            "value": {
                                "assetId": "Alexa.Setting.FanSpeed"
                            }
                        }
                    ]
                },
                "configuration": {
                    "supportedRange": {
                        "minimumValue": 0,
                        "maximumValue": 100,
                        "precision": 10
                    },
                    "unitOfMeasure": "Alexa.Unit.Percent"
                }
            } as DiscoveryCapability);
        }

        return {
            displayCategories: ['FAN'],
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & OnOff & Fan): Promise<Partial<Report>> {
        let data = {
            context: {
                properties: []
            }
        } as Partial<StateReport>;

        if (eventSource.interfaces.includes(ScryptedInterface.OnOff)) {
            data.context.properties.push({
                "namespace": "Alexa.PowerController",
                "name": "powerState",
                "value": eventSource.on ? "ON" : "OFF",
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            } as Property);
        }

        if (eventSource.interfaces.includes(ScryptedInterface.Fan)) {
            data.context.properties.push({
                "namespace": "Alexa.RangeController",
                "instance": "Fan.Speed",
                "name": "rangeValue",
                "value": fanSpeedToRangeValue(eventSource),
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            } as Property);
        }

        return data;
    },
    async sendEvent(eventSource: ScryptedDevice & OnOff & Fan, eventDetails, eventData): Promise<Partial<Report>> {
        if (eventDetails.eventInterface === ScryptedInterface.OnOff)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.PowerController",
                                    "name": "powerState",
                                    "value": eventData ? "ON" : "OFF",
                                    "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                }
            } as Partial<ChangeReport>;

        if (eventDetails.eventInterface === ScryptedInterface.Fan)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.RangeController",
                                    "instance": "Fan.Speed",
                                    "name": "rangeValue",
                                    "value": fanSpeedToRangeValue(eventSource),
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
