import { Fan, ScryptedDevice } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { sendDeviceResponse } from "../../common";
import { v4 as createMessageId } from 'uuid';
import { alexaDeviceHandlers } from "../../handlers";
import { Directive, Response } from "../../alexa";
import { fanSpeedToRangeValue, rangeValueToFanSpeed } from "../fan";

function commonRangeResponse(header, endpoint, payload, response, device: ScryptedDevice & Fan) {
    const data = {
        "event": {
            "header": {
                "namespace": "Alexa",
                "name": "Response",
                "messageId": createMessageId(),
                "correlationToken": header.correlationToken,
                "payloadVersion": "3"
            },
            endpoint,
            payload
        },
        "context": {
            "properties": [
                {
                    "namespace": "Alexa.RangeController",
                    "instance": "Fan.Speed",
                    "name": "rangeValue",
                    "value": fanSpeedToRangeValue(device),
                    "timeOfSample": new Date().toISOString(),
                    "uncertaintyInMilliseconds": 500
                }
            ]
        }
    };

    sendDeviceResponse(data, response, device);
}

alexaDeviceHandlers.set('Alexa.RangeController/SetRangeValue', async (request, response, directive: Directive, device: ScryptedDevice & Fan) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const rangeValue = Math.max(0, Math.min(100, (payload as any).rangeValue));

    await device.setFan({
        speed: rangeValueToFanSpeed(device, rangeValue),
    });

    commonRangeResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.RangeController/AdjustRangeValue', async (request, response, directive: Directive, device: ScryptedDevice & Fan) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const current = fanSpeedToRangeValue(device);
    const rangeValue = Math.max(0, Math.min(100, current + (payload as any).rangeValueDelta));

    await device.setFan({
        speed: rangeValueToFanSpeed(device, rangeValue),
    });

    commonRangeResponse(header, endpoint, payload, response, device);
});
