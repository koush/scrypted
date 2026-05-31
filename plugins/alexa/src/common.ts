import { Battery, Online, PowerSensor, ScryptedDevice, ScryptedInterface, HttpResponse } from "@scrypted/sdk";
import { v4 as createMessageId } from 'uuid';

export interface AlexaHttpResponse extends HttpResponse {
    send(body: any, options?: any): void;
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
                "reason": device.online ? undefined : "INTERNET_UNREACHABLE"
            },
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

export function authErrorResponse(errorType: string, errorMessage: string, directive: any): any {
    const { header } = directive;
    const data = {
        "event": {
            header,
            "payload": {
                "type": errorType,
                "message": errorMessage
            }
        }
    };

    data.event.header.name = "ErrorResponse";
    data.event.header.messageId = createMessageId();

    return data;
}

// https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-errorresponse.html#error-types
export function deviceErrorResponse (errorType: string, errorMessage: string, directive: any): any{
    const { header, endpoint } = directive;
    const data = {
        "event": {
            header,
            endpoint,
            "payload": {
                "type": errorType,
                "message": errorMessage
            }
        }
    };

    data.event.header.name = "ErrorResponse";
    data.event.header.messageId = createMessageId();

    return data;
}

export function mirroredResponse (directive: any): any {
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

    return data;
}

export function sendDeviceResponse(data: any, response: any, device: ScryptedDevice) {
    data = addBattery(data, device);
    data = addOnline(data, device);

    response.send(data);
}