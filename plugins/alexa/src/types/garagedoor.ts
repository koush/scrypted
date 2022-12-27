import { BinarySensor, Entry, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { getCameraCapabilities } from "./camera";
import { addSupportedType, EventReport, StateReport } from "./common";
import { DisplayCategory } from "alexa-smarthome-ts";

addSupportedType(ScryptedDeviceType.Garage, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.EntrySensor))
            return;

        const capabilities = getCameraCapabilities(device);
        capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa.ModeController",
                "instance": "GarageDoor.Position",
                "version": "3",
                "properties": {
                  "supported": [
                    {
                      "name": "mode"
                    }
                  ],
                  "retrievable": true,
                  "proactivelyReported": true
                },
                "capabilityResources": {
                  "friendlyNames": [
                    {
                      "@type": "asset",
                      "value": {
                        "assetId": "Alexa.Setting.Mode"
                      }
                    }
                  ]
                },
                "configuration": {
                  "ordered": false,
                  "supportedModes": [
                    {
                      "value": "Position.Up",
                      "modeResources": {
                        "friendlyNames": [
                          {
                            "@type": "asset",
                            "value": {
                              "assetId": "Alexa.Value.Open"
                            }
                          },
                          {
                            "@type": "text",
                            "value": {
                              "text": "Open",
                              "locale": "en-US"
                            }
                          }
                        ]
                      }
                    },
                    {
                      "value": "Position.Down",
                      "modeResources": {
                        "friendlyNames": [
                          {
                            "@type": "asset",
                            "value": {
                              "assetId": "Alexa.Value.Close"
                            }
                          },
                          {
                            "@type": "text",
                            "value": {
                              "text": "Closed",
                              "locale": "en-US"
                            }
                          }
                        ]
                      }
                    }
                  ]
                },
                "semantics": {
                  "actionMappings": [
                    {
                      "@type": "ActionsToDirective",
                      "actions": ["Alexa.Actions.Close", "Alexa.Actions.Lower"],
                      "directive": {
                        "name": "SetMode",
                        "payload": {
                          "mode": "Position.Down"
                        }
                      }
                    },
                    {
                      "@type": "ActionsToDirective",
                      "actions": ["Alexa.Actions.Open", "Alexa.Actions.Raise"],
                      "directive": {
                        "name": "SetMode",
                        "payload": {
                          "mode": "Position.Up"
                        }
                      }
                    }
                  ],
                  "stateMappings": [
                    {
                      "@type": "StatesToValue",
                      "states": ["Alexa.States.Closed"],
                      "value": "Position.Down"
                    },
                    {
                      "@type": "StatesToValue",
                      "states": ["Alexa.States.Open"],
                      "value": "Position.Up"
                    }  
                  ]
                }
              } as any,
        );

        return {
            displayCategories: ['GARAGE_DOOR'],
            capabilities
        }
    },
    async reportState(eventSource: ScryptedDevice & EntrySensor): Promise<StateReport> {
        return {
            type: 'state',
            namespace: 'Alexa',
            name: 'StateReport',
            context: {
                "properties": [
                    {
                        "namespace": "Alexa.ModeController",
                        "instance": "GarageDoor.Position",
                        "name": "mode",
                        "value": eventSource.entryOpen ? "Position.Up" : "Position.Down",
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    }
                ]
            }
        };
    },
    async sendEvent(eventSource: ScryptedDevice & EntrySensor, eventDetails, eventData): Promise<EventReport> {      
      if (eventDetails.eventInterface !== ScryptedInterface.EntrySensor)
        return undefined;

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
                      "namespace": "Alexa.ModeController",
                      "instance": "GarageDoor.Position",
                      "name": "mode",
                      "value": eventSource.entryOpen ? "Position.Up" : "Position.Down",
                      "timeOfSample": new Date().toISOString(),
                      "uncertaintyInMilliseconds": 0
                    }
                  ]
              }
          },
  };
  }
});
