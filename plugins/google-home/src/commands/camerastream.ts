import { RTCAVSignalingSetup, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDevice, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";
import { Deferred } from '@scrypted/common/src/deferred';

import sdk from "@scrypted/sdk";
const { mediaManager, endpointManager, systemManager } = sdk;

const tokens: { [token: string]: string } = {};

export function canAccess(token: string) {
    const id = tokens[token];
    return systemManager.getDeviceById(id) as ScryptedDevice & RTCSignalingChannel;
}

commandHandlers['action.devices.commands.GetCameraStream'] = async (device: ScryptedDevice & RTCSignalingChannel, execution) => {
    const ret = executeResponse(device);

    const cameraStreamAuthToken = `tok-${Math.round(Math.random() * 10000).toString(16)}`;
    tokens[cameraStreamAuthToken] = device.id;

    if (execution.params.SupportedStreamProtocols.length === 1 && execution.params.SupportedStreamProtocols.includes('webrtc')) {
        const endpoint = await endpointManager.getPublicLocalEndpoint() + `signaling/`;
        const mo = await mediaManager.createMediaObject(Buffer.from(endpoint), ScryptedMimeTypes.LocalUrl);
        const cameraStreamSignalingUrl = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);

        tokens[cameraStreamAuthToken] = device.id;

        ret.states = {
            // cameraStreamOffer,
            cameraStreamSignalingUrl,
            cameraStreamAuthToken,
            cameraStreamProtocol: 'webrtc',
            // cameraStreamIceServers: JSON.stringify(cameraStreamIceServers),
        }
    }
    else {
        const engineio = await endpointManager.getPublicLocalEndpoint() + 'engine.io/';
        const mo = await mediaManager.createMediaObject(Buffer.from(engineio), ScryptedMimeTypes.LocalUrl);
        const cameraStreamAccessUrl = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);

        ret.states = {
            cameraStreamAccessUrl,
            // cameraStreamReceiverAppId: "9E3714BD",
            cameraStreamReceiverAppId: "00F7C5DD",
            cameraStreamAuthToken,
        }
    }

    return ret;
}

class Session implements RTCSignalingSession {
    __proxy_props: { options: RTCSignalingOptions; };
    options: RTCSignalingOptions;
    deferred: Deferred<{
        description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup,
    }>;
    offer: RTCSessionDescriptionInit;

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        return this.offer;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
        this.deferred.resolve({description, setup});
    }

    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return this.options;
    }
};

export async function signalCamera(device: ScryptedDevice & RTCSignalingChannel, body: any) {
    if (body.action === 'offer') {
        const offer: RTCSessionDescriptionInit = {
            sdp: body.sdp,
            type: 'offer',
        };

        const options: RTCSignalingOptions = {
            requiresOffer: true,
            disableTrickle: true,
        }

        const session = new Session();
        session.__proxy_props = { options };
        session.options = options;
        session.deferred = new Deferred<{
            description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup,
        }>();
        session.offer = offer;

        device.startRTCSignalingSession(session);

        const answer = await session.deferred.promise;

        const sdp = answer.description.sdp.replace('sendrecv', 'sendonly');

        return {
            action: 'answer',
            sdp,
        }
    }
    else {
        return {};
    }
}