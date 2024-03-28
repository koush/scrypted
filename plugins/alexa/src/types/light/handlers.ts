import { Brightness, ColorHsv, ColorSettingHsv, ColorSettingTemperature, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { deviceErrorResponse, sendDeviceResponse } from "../../common";
import { v4 as createMessageId } from 'uuid';
import { alexaDeviceHandlers } from "../../handlers";
import { Directive, Response } from "../../alexa";
import { error } from "console";

function commonBrightnessResponse(header, endpoint, payload, response, device: ScryptedDevice & Brightness) {
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
                "name": "brightness",
                "value": device.brightness,
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

alexaDeviceHandlers.set('Alexa.BrightnessController/SetBrightness', async (request, response, directive: Directive, device: ScryptedDevice & Brightness) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.setBrightness((payload as any).brightness)

    commonBrightnessResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.BrightnessController/AdjustBrightness', async (request, response, directive: Directive, device: ScryptedDevice & Brightness) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.setBrightness(device.brightness + (payload as any).brightnessDelta)

    commonBrightnessResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.ColorController/SetColor', async (request, response, directive: Directive, device: ScryptedDevice & ColorSettingHsv) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    let hsv : ColorHsv = { 
        h: (payload as any).color.hue,
        s: (payload as any).color.saturation, 
        v: (payload as any).color.brightness
    };

    if (!device.interfaces.includes(ScryptedInterface.ColorSettingHsv))
        return deviceErrorResponse("INVALID_REQUEST_EXCEPTION", "Device does not support setting color by HSV.", directive);

    await device.setHsv(hsv.h, hsv.s, hsv.v);
    hsv = device.hsv;

    const data : Response = {
        "event": {
            "header": {
                "namespace": "Alexa",
                "name": "Response",
                "messageId": createMessageId(),
                "correlationToken": header.correlationToken,
                "payloadVersion": header.payloadVersion
            },
            endpoint,
            payload
        },
        "context": {
            "properties": [
              {
                "namespace": "Alexa.ColorController",
                "name": "color",
                "value": {
                    "hue": hsv.h,
                    "saturation": hsv.s,
                    "brightness": hsv.v
                },
                "timeOfSample": new Date().toISOString(),
                "uncertaintyInMilliseconds": 500
              }
            ]
        }
    };

    sendDeviceResponse(data, response, device);
});

function commonColorTemperatureResponse(header, endpoint, payload, response, device: ScryptedDevice & ColorSettingTemperature) {
    const data : Response = {
        "event": {
            header,
            endpoint,
            payload
        },
        "context": {
            "properties": [
              {
                "namespace": "Alexa.ColorTemperatureController",
                "name": "colorTemperatureInKelvin",
                "value": device.colorTemperature,
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

alexaDeviceHandlers.set('Alexa.ColorTemperatureController/SetColorTemperature', async (request, response, directive: Directive, device: ScryptedDevice & ColorSettingTemperature) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.setColorTemperature((payload as any).colorTemperatureInKelvin)

    commonColorTemperatureResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.ColorTemperatureController/IncreaseColorTemperature', async (request, response, directive: Directive, device: ScryptedDevice & ColorSettingTemperature) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.setColorTemperature(device.colorTemperature + 500);

    commonColorTemperatureResponse(header, endpoint, payload, response, device);
});

alexaDeviceHandlers.set('Alexa.ColorTemperatureController/DecreaseColorTemperature', async (request, response, directive: Directive, device: ScryptedDevice & ColorSettingTemperature) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    await device.setColorTemperature(device.colorTemperature - 500);

    commonColorTemperatureResponse(header, endpoint, payload, response, device);
});