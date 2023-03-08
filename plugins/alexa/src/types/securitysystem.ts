import { EventDetails, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, SecuritySystem, SecuritySystemMode } from "@scrypted/sdk";
import { DiscoveryEndpoint, DiscoveryCapability, ChangeReport, Report, StateReport, DisplayCategory, ChangePayload, Property } from "../alexa";
import { supportedTypes } from ".";

function getArmState(mode: SecuritySystemMode): string {
    switch(mode) {
        case SecuritySystemMode.AwayArmed:
            return 'ARMED_AWAY';
        case SecuritySystemMode.HomeArmed:
            return 'ARMED_STAY';
        case SecuritySystemMode.NightArmed:
            return 'ARMED_NIGHT';
        case SecuritySystemMode.Disarmed:
            return 'DISARMED';
    }
}

supportedTypes.set(ScryptedDeviceType.SecuritySystem, {
  async discover(device: ScryptedDevice & SecuritySystem): Promise<Partial<DiscoveryEndpoint>> {
        const capabilities: DiscoveryCapability[] = [];
        const displayCategories: DisplayCategory[] = [];

        if (device.interfaces.includes(ScryptedInterface.SecuritySystem)) {
            const supportedModes = device.securitySystemState.supportedModes;

            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.SecurityPanelController",
                    "version": "3",
                    "properties": {
                      "supported": [
                        {
                          "name": "armState"
                        },
                        {
                          "name": "burglaryAlarm"
                        },
                        //{
                        //    "name": "waterAlarm"
                        //},
                        //{
                        //    "name": "fireAlarm"
                        //},
                        //{
                        //    "name": "carbonMonoxideAlarm"
                        //}
                        ],
                        "proactivelyReported": true,
                        "retrievable": true
                    },
                    "configuration": {
                        "supportedArmStates": supportedModes.map(mode => {
                            return {
                                "value": getArmState(mode)
                            }
                        }),
                        "supportedAuthorizationTypes": [
                          {
                            "type": "FOUR_DIGIT_PIN"
                          }
                        ]
                    }
                 } as DiscoveryCapability
            );

            displayCategories.push('SECURITY_PANEL');
        }

        if (capabilities.length === 0)
            return;

        return {
            displayCategories,
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & SecuritySystem): Promise<Partial<Report>> {
        let data = {
            context: {
                properties: []
            }
            
        } as Partial<StateReport>;
    
        if (eventSource.interfaces.includes(ScryptedInterface.SecuritySystem)) {
            data.context.properties.push({
                "namespace": "Alexa.SecurityPanelController",
                "name": "armState",
                "value": getArmState(eventSource.securitySystemState.mode),
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            } as Property);

            data.context.properties.push({
                "namespace": "Alexa.SecurityPanelController",
                "name": "burglaryAlarm",
                "value": {
                    "value": eventSource.securitySystemState.triggered ? "ALARM" : "OK",
                },
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            } as Property);
        }
    
        return data;
    },
    async sendEvent(eventSource: ScryptedDevice & SecuritySystem, eventDetails: EventDetails, eventData): Promise<Partial<Report>> {      
        if (eventDetails.eventInterface === ScryptedInterface.SecuritySystem && eventDetails.property === "mode") { 
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.SecurityPanelController",
                                    "name": "armState",
                                    "value": getArmState(eventData),
                                    "timeOfSample": new Date().toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                  } as Property
                            ]
                        }
                    } as ChangePayload,
                },
                context: {
                    properties: [{
                        "namespace": "Alexa.SecurityPanelController",
                        "name": "burglaryAlarm",
                        "value": {
                            "value": eventSource.securitySystemState.triggered ? "ALARM" : "OK",
                        },
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    } as Property]
                }
            } as Partial<ChangeReport>;
        }

        if (eventDetails.eventInterface === ScryptedInterface.SecuritySystem && eventDetails.property === "triggered") { 
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "RULE_TRIGGER"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.SecurityPanelController",
                                    "name": "burglaryAlarm",
                                    "value": {
                                      "value": eventData ? "ALARM" : "OK"
                                    },
                                    "timeOfSample": new Date().toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                },
                context: {
                    properties: [{
                        "namespace": "Alexa.SecurityPanelController",
                        "name": "armState",
                        "value": getArmState(eventSource.securitySystemState.mode),
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    } as Property]
                }
            } as Partial<ChangeReport>;
        }

        return undefined;
    }
});
