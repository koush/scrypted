import { ScryptedDevice } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { sendDeviceResponse } from "../../common";
import { alexaDeviceHandlers } from "../../handlers";
import { v4 as createMessageId } from 'uuid';
import { Response } from "../../alexa";

async function sendResponse (request, response, directive: any, device: ScryptedDevice) {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const report = await supportedType.setState(device, payload);
    const data = {
        "event": {
            header,
            endpoint,
            payload
        },
        context: report?.context
    } as Response;

    data.event.header.name = "Response";
    data.event.header.messageId = createMessageId();

    sendDeviceResponse(data, response, device);
}

alexaDeviceHandlers.set('Alexa.ModeController/SetMode', sendResponse);
alexaDeviceHandlers.set('Alexa.ModeController/AdjustMode', sendResponse); 