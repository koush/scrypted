import { Brightness, ColorSettingHsv, ColorSettingTemperature, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { DiscoveryEndpoint, ChangeReport, Report, Property, ChangePayload, DiscoveryCapability, StateReport } from "../alexa";
import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Light, {
    async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
        if (!device.interfaces.includes(ScryptedInterface.OnOff))
            return;

        const capabilities: DiscoveryCapability[] = [];
        if (device.interfaces.includes(ScryptedInterface.OnOff)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.PowerController",
                "version": "3",
                "properties": {
                    "supported": [{
                        "name": "powerState"
                    }],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            });
        }

        if (device.interfaces.includes(ScryptedInterface.Brightness)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.BrightnessController",
                "version": "3",
                "properties": {
                    "supported": [{
                        "name": "brightness"
                    }],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            });
        }

        if (device.interfaces.includes(ScryptedInterface.ColorSettingTemperature)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.ColorTemperatureController",
                "version": "3",
                "properties": {
                    "supported": [{
                        "name": "colorTemperatureInKelvin"
                    }],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            });
        }

        if (device.interfaces.includes(ScryptedInterface.ColorSettingHsv)) {
            capabilities.push({
                "type": "AlexaInterface",
                "interface": "Alexa.ColorController",
                "version": "3",
                "properties": {
                    "supported": [{
                        "name": "color"
                    }],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            });
        }

        return {
            displayCategories: ['LIGHT'],
            capabilities
        }
    },
    async sendReport(eventSource: ScryptedDevice & OnOff & Brightness & ColorSettingHsv & ColorSettingTemperature): Promise<Partial<Report>> {
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
            });
        }

        if (eventSource.interfaces.includes(ScryptedInterface.Brightness)) {
            data.context.properties.push({
                "namespace": "Alexa.BrightnessController",
                "name": "brightness",            
                "value": eventSource.brightness,
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }        

        if (eventSource.interfaces.includes(ScryptedInterface.ColorSettingHsv) && eventSource.hsv) {
            data.context.properties.push({
                "namespace": "Alexa.ColorController",
                "name": "color",            
                "value": {
                    "hue": eventSource.hsv.h,
                    "saturation": eventSource.hsv.s,
                    "brightness": eventSource.hsv.v
                },
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }

        if (eventSource.interfaces.includes(ScryptedInterface.ColorSettingTemperature) && eventSource.colorTemperature) {
            data.context.properties.push({
                "namespace": "Alexa.ColorTemperatureController",
                "name": "colorTemperatureInKelvin",            
                "value": eventSource.colorTemperature,
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 0
            });
        }

        return data;
    },
    async sendEvent(eventSource: ScryptedDevice & OnOff & Brightness & ColorSettingHsv & ColorSettingTemperature, eventDetails, eventData): Promise<Partial<Report>> {      
        if (eventDetails.eventInterface == ScryptedInterface.OnOff) 
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

        if (eventDetails.eventInterface == ScryptedInterface.Brightness && eventSource.brightness)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.BrightnessController",
                                    "name": "brightness",            
                                    "value": eventSource.brightness,
                                    "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                }
            } as Partial<ChangeReport>;

        if (eventDetails.eventInterface == ScryptedInterface.ColorSettingHsv && eventSource.hsv)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.ColorController",
                                    "name": "color",            
                                    "value": {
                                        "hue": eventSource.hsv.h,
                                        "saturation": eventSource.hsv.s,
                                        "brightness": eventSource.hsv.v
                                    },
                                    "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                    "uncertaintyInMilliseconds": 0
                                } as Property
                            ]
                        }
                    } as ChangePayload,
                }
            } as Partial<ChangeReport>;

        if (eventDetails.eventInterface == ScryptedInterface.ColorSettingTemperature && eventSource.colorTemperature)
            return {
                event: {
                    payload: {
                        change: {
                            cause: {
                                type: "PHYSICAL_INTERACTION"
                            },
                            properties: [
                                {
                                    "namespace": "Alexa.ColorTemperatureController",
                                    "name": "colorTemperatureInKelvin",            
                                    "value": eventSource.colorTemperature,
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
