import { ScryptedDevice, SecuritySystem, SecuritySystemMode } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { deviceErrorResponse, sendDeviceResponse } from "../../common";
import { v4 as createMessageId } from 'uuid';
import { alexaDeviceHandlers } from "../../handlers";
import { Directive, Response } from "../../alexa";
import { getArmState } from "../securitysystem";

function getSecuritySystemMode(armState: string): SecuritySystemMode {
    switch (armState) {
        case 'ARMED_AWAY':
            return SecuritySystemMode.AwayArmed;
        case 'ARMED_STAY':
            return SecuritySystemMode.HomeArmed;
        case 'ARMED_NIGHT':
            return SecuritySystemMode.NightArmed;
        case 'DISARMED':
            return SecuritySystemMode.Disarmed;
    }
}

alexaDeviceHandlers.set('Alexa.SecurityPanelController/Arm', async (request, response, directive: Directive, device: ScryptedDevice & SecuritySystem) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const targetState = (payload as any).armState as string;
    const targetMode = getSecuritySystemMode(targetState);

    if (targetMode === undefined) {
        response.send(deviceErrorResponse("INVALID_VALUE", `Unsupported arm state: ${targetState}`, directive));
        return;
    }

    // Alexa requires that the system not transition directly from ARMED_AWAY to another
    // armed state. The user must disarm first.
    // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-securitypanelcontroller.html
    const currentMode = device.securitySystemState?.mode;
    if (currentMode === SecuritySystemMode.AwayArmed
        && targetMode !== SecuritySystemMode.Disarmed
        && targetMode !== SecuritySystemMode.AwayArmed) {
        response.send(deviceErrorResponse("AUTHORIZATION_REQUIRED", "The security system must be disarmed before changing to another armed state.", directive));
        return;
    }

    await device.armSecuritySystem(targetMode);

    const data = {
        "event": {
            "header": {
                "namespace": "Alexa.SecurityPanelController",
                "name": "Arm.Response",
                "messageId": createMessageId(),
                "correlationToken": header.correlationToken,
                "payloadVersion": "3"
            },
            endpoint,
            "payload": {}
        },
        "context": {
            "properties": [
                {
                    "namespace": "Alexa.SecurityPanelController",
                    "name": "armState",
                    "value": getArmState(targetMode),
                    "timeOfSample": new Date().toISOString(),
                    "uncertaintyInMilliseconds": 0
                }
            ]
        }
    };

    sendDeviceResponse(data, response, device);
});

alexaDeviceHandlers.set('Alexa.SecurityPanelController/Disarm', async (request, response, directive: Directive, device: ScryptedDevice & SecuritySystem) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;

    await device.disarmSecuritySystem();

    const data: Response = {
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
                    "namespace": "Alexa.SecurityPanelController",
                    "name": "armState",
                    "value": "DISARMED",
                    "timeOfSample": new Date().toISOString(),
                    "uncertaintyInMilliseconds": 0
                }
            ]
        }
    };

    sendDeviceResponse(data, response, device);
});
