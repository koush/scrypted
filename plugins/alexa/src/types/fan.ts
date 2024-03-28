import { OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { DiscoveryEndpoint, ChangeReport, Report, Property, ChangePayload, DiscoveryCapability } from "../alexa";
import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Fan, {
    async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
        if (!device.interfaces.includes(ScryptedInterface.OnOff))
            return;

        const capabilities: DiscoveryCapability[] = [];
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

        return {
            displayCategories: ['FAN'],
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & OnOff): Promise<Partial<Report>> {
        return {
            context: {
                "properties": [
                    {
                        "namespace": "Alexa.PowerController",
                        "name": "powerState",
                        "value": eventSource.on ? "ON" : "OFF",
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    } as Property
                ]
            }
        };
    },
    async sendEvent(eventSource: ScryptedDevice & OnOff, eventDetails, eventData): Promise<Partial<Report>> {      
        if (eventDetails.eventInterface !== ScryptedInterface.OnOff)
            return undefined;

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
                                "timeOfSample": new Date().toISOString(),
                                "uncertaintyInMilliseconds": 0
                            } as Property
                        ]
                    }
                } as ChangePayload,
            }
        } as Partial<ChangeReport>;
    }
});
