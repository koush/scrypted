import { Entry, EntrySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { DiscoveryEndpoint, DiscoveryCapability, ChangeReport, Report } from "../alexa";
import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Garage, {
  async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
    if (!device.interfaces.includes(ScryptedInterface.EntrySensor))
            return;

        const capabilities: DiscoveryCapability[] = [];
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
              },
        );

        return {
            displayCategories: ['GARAGE_DOOR'],
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & EntrySensor): Promise<Partial<Report>> {
        return {
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
    async sendEvent(eventSource: ScryptedDevice & Entry & EntrySensor, eventDetails, eventData): Promise<Partial<Report>> {      
      if (eventDetails.eventInterface !== ScryptedInterface.EntrySensor)
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
        }
      } as Partial<ChangeReport>;
    },
    async setState(eventSource: ScryptedDevice & Entry & EntrySensor, payload: any): Promise<Partial<Report>> {
      if (payload.mode === 'Position.Up') {
        await eventSource.openEntry();
      }
      else if (payload.mode === 'Position.Down') {
        await eventSource.closeEntry();
      }

      return {
          context: {
              "properties": [
                  {
                      "namespace": "Alexa.ModeController",
                      "instance": "GarageDoor.Position",
                      "name": "mode",
                      "value": payload.mode,
                      "timeOfSample": new Date().toISOString(),
                      "uncertaintyInMilliseconds": 0
                  }
              ]
          }
        };
    }
});
