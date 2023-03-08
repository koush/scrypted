import { HttpRequest, ScryptedDevice } from "@scrypted/sdk";
import { AlexaHttpResponse, sendDeviceResponse } from "./common";
import { supportedTypes } from "./types";
import { v4 as createMessageId } from 'uuid';
import { Directive, StateReport } from "./alexa";

export type AlexaHandler = (request: HttpRequest, response: AlexaHttpResponse, directive: Directive) => Promise<void>
export type AlexaDeviceHandler<T> = (request: HttpRequest, response: AlexaHttpResponse, directive: Directive, device: ScryptedDevice & T) => Promise<void>

export const alexaDeviceHandlers = new Map<string, AlexaDeviceHandler<any>>();
export const alexaHandlers = new Map<string, AlexaHandler>();

alexaDeviceHandlers.set('Alexa/ReportState', async (request, response, directive: any, device: ScryptedDevice) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const report = await supportedType.sendReport(device);

    let data = {
        "event": {
            header,
            endpoint,
            payload
        },
        context: report?.context
    } as StateReport;

    data.event.header.name = "StateReport";
    data.event.header.messageId = createMessageId();

    sendDeviceResponse(data, response, device);
});