import { RTCSignalingChannel, ScryptedDevice, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

import sdk from "@scrypted/sdk";
const {mediaManager, endpointManager, systemManager } = sdk;

const tokens: { [token: string]: string } = {};

export function canAccess(token: string) {
    const id = tokens[token];
    return systemManager.getDeviceById(id) as ScryptedDevice & RTCSignalingChannel;
}

commandHandlers['action.devices.commands.GetCameraStream'] = async (device: ScryptedDevice, execution) => {
    const ret = executeResponse(device);

    const engineio = await endpointManager.getPublicLocalEndpoint() + 'engine.io/';
    const mo = await mediaManager.createMediaObject(Buffer.from(engineio), ScryptedMimeTypes.LocalUrl);
    const cameraStreamAccessUrl = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);

    const cameraStreamAuthToken = `tok-${Math.round(Math.random() * 10000).toString(16)}`;
    tokens[cameraStreamAuthToken] = device.id;

    ret.states = {
        cameraStreamAccessUrl,
        // cameraStreamReceiverAppId: "9E3714BD",
        cameraStreamReceiverAppId: "00F7C5DD",
        cameraStreamAuthToken,
    }
    return ret;
}
