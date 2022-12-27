import { Battery, EventDetails, HttpRequest, HttpResponse, Online, PowerSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import {DiscoveryEndpoint, Directive} from 'alexa-smarthome-ts';
import { createMessageId } from "../message";

export type AlexaHandler = (request: HttpRequest, response: HttpResponse, directive: Directive) => Promise<void>
export type AlexaCapabilityHandler<T> = (request: HttpRequest, response: HttpResponse, directive: Directive, device: ScryptedDevice & T) => Promise<void>

export const supportedTypes = new Map<ScryptedDeviceType, SupportedType>();
export const capabilityHandlers = new Map<string, AlexaCapabilityHandler<any>>();
export const alexaHandlers = new Map<string, AlexaCapabilityHandler<any>>();

export interface EventReport {
    type: 'event';
    payload?: any;
    context?: any;
    namespace?: string;
    name?: string;
}

export interface StateReport {
    type: 'state';
    payload?: any;
    context?: any;
    namespace?: string;
    name?: string;
}

export interface SupportedType {
    probe(device: ScryptedDevice): Partial<DiscoveryEndpoint<any>>;
    sendEvent(eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<EventReport>;
    reportState(device: ScryptedDevice): Promise<StateReport>;
}

export function addSupportedType(type: ScryptedDeviceType, supportedType: SupportedType) {
    supportedTypes.set(type, supportedType);
}

export function isSupported(device: ScryptedDevice) {
    return supportedTypes.get(device.type)?.probe(device);
}

export function addOnline(data: any, device: ScryptedDevice & Online) : any {
    if (!device.interfaces.includes(ScryptedInterface.Online))
        return data;

    if (data.context === undefined)
        data.context = {};

    if (data.context.properties === undefined)
        data.context.properties = [];

    data.context.properties.push(
        {
            "namespace": "Alexa.EndpointHealth",
            "name": "connectivity",
            "value": {
                "value": device.online ? "OK" : "UNREACHABLE",
            },
            "timeOfSample": new Date().toISOString(),
            "uncertaintyInMilliseconds": 0
          }
    );

    return data;
}

export function addPowerSensor(data: any, device: ScryptedDevice & PowerSensor) : any {
    if (!device.interfaces.includes(ScryptedInterface.PowerSensor))
        return data;

    if (data.context === undefined)
        data.context = {};

    if (data.context.properties === undefined)
        data.context.properties = [];

    data.context.properties.push(
        {
            "namespace": "Alexa.PowerController",
            "name": "powerState",
            "value": device.powerDetected ? "ON" : "OFF",
            "timeOfSample": new Date().toISOString(),
            "uncertaintyInMilliseconds": 0
          }
    );

    return data;
}

export function addBattery(data: any, device: ScryptedDevice & Battery) : any {
    if (!device.interfaces.includes(ScryptedInterface.Battery))
        return data;

    if (data.context === undefined)
        data.context = {};

    if (data.context.properties === undefined)
        data.context.properties = [];

    const lowPower = device.batteryLevel < 20;
    let health = undefined;

    if (lowPower) {
        health = {
            "state": "WARNING",
            "reasons": [
                "LOW_CHARGE"
            ]
        };
    }

    data.context.properties.push(
        {
            "namespace": "Alexa.EndpointHealth",
            "name": "battery",
            "value": {
                health,
                "levelPercentage": device.batteryLevel,
            },
            "timeOfSample": new Date().toISOString(),
            "uncertaintyInMilliseconds": 0
          }
    );

    return data;
}

function sendResponse(data: any, response: any, device: ScryptedDevice) {
    data = addBattery(data, device);
    data = addOnline(data, device);
    data = addPowerSensor(data, device);

    response.send(JSON.stringify(data));
}

alexaHandlers.set('ReportState', async (request, response, directive: any, device: ScryptedDevice) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint } = directive;

    const report = await supportedType.reportState(device);
    if (report.type === 'state') {
        const data = {
            "event": {
                header,
                endpoint,
                payload: report.payload,
            },
            "context": report.context
        };

        data.event.header.name = "StateReport";
        data.event.header.messageId = createMessageId();

        sendResponse(data, response, device);
    }
});

capabilityHandlers.set('Alexa', async (request, response, directive: any, device: ScryptedDevice) => {
    const { name } = directive.header;
    let handler = alexaHandlers.get(name);
    if (handler)
        return handler.apply(this, [request, response, directive, device]);

    const { header, endpoint, payload } = directive;
    const data = {
        "event": {
            header,
            endpoint,
            payload
        }
    };

    data.event.header.name = "Response";
    data.event.header.messageId = createMessageId();

    sendResponse(data, response, device);
});