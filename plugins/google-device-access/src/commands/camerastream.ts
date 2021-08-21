import { Brightness, OnOff, ScryptedDevice, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

import sdk from "@scrypted/sdk";
const {mediaManager, endpointManager } = sdk;

const tokens: { [token: string]: string } = {};

export function canAccess(device: ScryptedDevice, token: string): boolean {
    return device && tokens[token] === device.id;
}

commandHandlers['action.devices.commands.GetCameraStream'] = async (device: ScryptedDevice & VideoCamera, execution) => {
    const ret = executeResponse(device);

    const engineio = await endpointManager.getPublicLocalEndpoint() + 'engine.io/';
    const mo = mediaManager.createMediaObject(engineio, ScryptedMimeTypes.LocalUrl);
    const cameraStreamAuthToken = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);

    const token = Math.random().toString();
    tokens[token] = device.id;

    ret.states = {
        cameraStreamAccessUrl: `camera://${device.id}?token=${token}`,
        cameraStreamReceiverAppId: "00F7C5DD",
        cameraStreamAuthToken,
    }
    return ret;
}
