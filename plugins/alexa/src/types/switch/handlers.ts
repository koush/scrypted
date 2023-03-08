import { OnOff, ScryptedDevice } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { sendDeviceResponse } from "../../common";
import { v4 as createMessageId } from 'uuid';
import { alexaDeviceHandlers } from "../../handlers";
import { Directive, Response } from "../../alexa";

function commonResponse(header, endpoint, payload, response, device: ScryptedDevice & OnOff) {
    const data : Response = {
        "event": {
            header,
            endpoint,
            payload
        },
        "context": {
            "properties": [
              {
                "namespace": "Alexa.PowerController",
                "name": "powerState",
                "value": device.on ? "ON" : "OFF",
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 500
              }
            ]
        }
    };

    data.event.header.namespace = "Alexa";
    data.event.header.name = "Response";
    data.event.header.messageId = createMessageId();

    sendDeviceResponse(data, response, device);
}

alexaDeviceHandlers.set('Alexa.PowerController/TurnOn', async (request, response, directive: Directive, device: ScryptedDevice & OnOff) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.turnOn();

    commonResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.PowerController/TurnOff', async (request, response, directive: Directive, device: ScryptedDevice & OnOff) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.turnOff();

    commonResponse(header, endpoint, payload, response, device);
});