import sdk, { FFMpegInput, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import { addSupportedType, AlexaCapabilityHandler, capabilityHandlers } from "./common";
import { startRTCPeerConnectionFFmpegInput } from '@scrypted/common/src/ffmpeg-to-wrtc';
import { BrowserSignalingSession, startRTCSignalingSession } from '@scrypted/common/src/rtc-signaling';
import crypto from 'crypto';

const { mediaManager } = sdk;

addSupportedType(ScryptedDeviceType.Camera, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.VideoCamera))
            return;

        return {
            displayCategories: ['CAMERA'],
            capabilities: [
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.RTCSessionController",
                    "version": "3",
                    "configuration": {
                        "isFullDuplexAudioSupported": false,
                    }
                },
            ],
        }
    }
});

export const rtcHandlers = new Map<string, AlexaCapabilityHandler<any>>();

rtcHandlers.set('InitiateSessionWithOffer', async (request, response, directive: any, device: ScryptedDevice & VideoCamera) => {
    const mo = await device.getVideoStream();
    const ffInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
    const pc = await startRTCPeerConnectionFFmpegInput(ffInput, {
        maxWidth: 960,
    });

    const session = new BrowserSignalingSession(pc);
    session.options = undefined;
    session.hasSetup = true;

    const sdp: string = directive.payload.offer.value.replaceAll('sendrecv', 'recvonly');

    setTimeout(() => {
        pc.onicecandidate({
            candidate: undefined,
        } as any)
    },2000)

    startRTCSignalingSession(session, {
        sdp,
        type: 'offer',
    }, console, async () => undefined, async (remoteDescription: RTCSessionDescriptionInit) => {
        response.send(JSON.stringify({
            "event": {
                "header": {
                    "namespace": "Alexa.RTCSessionController",
                    "name": "AnswerGeneratedForSession",
                    "messageId": crypto.randomBytes(8).toString('hex'),
                    "payloadVersion": "3"
                },
                "payload": {
                    "answer": {
                        "format": "SDP",
                        "value": remoteDescription.sdp,
                    }
                }
            }
        }));

        return undefined;
    });
});

capabilityHandlers.set('Alexa.RTCSessionController', async (request, response, directive: any, device: ScryptedDevice & VideoCamera) => {
    const { name } = directive.header;
    const handler = rtcHandlers.get(name);
    if (handler)
        return handler.apply(this, [request, response, directive, device]);

    const { sessionId } = directive.payload;
    const body = {
        "event": {
            "header": {
                "namespace": "Alexa.RTCSessionController",
                name,
                "messageId": crypto.randomBytes(8).toString('hex'),
                "payloadVersion": "3"
            },
            "payload": {
                sessionId,
            }
        }
    };

    response.send(JSON.stringify(body));
});
