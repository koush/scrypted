import { ObjectDetector, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDevice } from "@scrypted/sdk";
import { supportedTypes } from "..";
import { v4 as createMessageId } from 'uuid';
import { AlexaHttpResponse, sendDeviceResponse } from "../../common";
import { alexaDeviceHandlers } from "../../handlers";
import { Response, WebRTCAnswerGeneratedForSessionEvent, WebRTCSessionConnectedEvent, WebRTCSessionDisconnectedEvent } from '../../alexa'
import { Deferred } from '@scrypted/common/src/deferred';

export class AlexaSignalingSession implements RTCSignalingSession {
    constructor(public response: AlexaHttpResponse, public directive: any) {
        this.options = this.createOptions();
        this.__proxy_props = { options: this.createOptions() };
    }

    __proxy_props: { options: RTCSignalingOptions; };
    options: RTCSignalingOptions;
    remoteDescription = new Deferred<void>();

    async getOptions(): Promise<RTCSignalingOptions> {
        return this.options;
    }

    private createOptions() {
        const options: RTCSignalingOptions = {
            proxy: true,
            offer: {
                type: 'offer',
                sdp: this.directive.payload.offer.value,
            },
            disableTrickle: true,
            disableTurn: true,
            // this could be a low resolution screen, no way of knowning, so never send a 1080p stream
            screen: {
                devicePixelRatio: 1,
                width: 1280,
                height: 720
            }
        };

        return options;
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        if (type !== 'offer') {
            const e = new Error('Alexa only supports RTC offer');
            this.remoteDescription.reject(e);
            throw e;
        }

        if (sendIceCandidate) {
            const e = new Error("Alexa does not support trickle ICE");
            this.remoteDescription.reject(e);
            throw e;
        }

        return {
            type: type,
            sdp: this.directive.payload.offer.value,
        }
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        throw new Error("Alexa does not support trickle ICE");
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {

        const { header, endpoint, payload } = this.directive;

        const data: WebRTCAnswerGeneratedForSessionEvent = {
            "event": {
                header,
                endpoint,
                payload
            },
            context: undefined
        };

        data.event.header.name = "AnswerGeneratedForSession";
        data.event.header.messageId = createMessageId();

        data.event.payload.answer = {
            format: 'SDP',
            value: description.sdp,
        };

        this.remoteDescription.resolve();
        this.response.send(data);
    }
}

const sessionCache = new Map<string, RTCSessionControl>();

alexaDeviceHandlers.set('Alexa.RTCSessionController/InitiateSessionWithOffer', async (request, response, directive: any, device: ScryptedDevice & RTCSignalingChannel) => {
    const { header, endpoint, payload } = directive;
    const { sessionId } = payload;

    const session = new AlexaSignalingSession(response, directive);
    const control = await device.startRTCSignalingSession(session);
    control.setPlayback({
        audio: true,
        video: false,
    });
    await session.remoteDescription.promise;

    sessionCache.set(sessionId, control);
});

alexaDeviceHandlers.set('Alexa.RTCSessionController/SessionConnected', async (request, response, directive: any, device: ScryptedDevice) => {
    const { header, endpoint, payload } = directive;
    const data: WebRTCSessionConnectedEvent = {
        "event": {
            header,
            endpoint,
            payload
        },
        context: undefined
    };

    data.event.header.messageId = createMessageId();

    response.send(data);
});

alexaDeviceHandlers.set('Alexa.RTCSessionController/SessionDisconnected', async (request, response, directive: any, device: ScryptedDevice) => {
    const { header, endpoint, payload } = directive;
    const { sessionId } = payload;

    const session = sessionCache.get(sessionId);
    if (session) {
        sessionCache.delete(sessionId);
        await session.endSession();
    }

    const data: WebRTCSessionDisconnectedEvent = {
        "event": {
            header,
            endpoint,
            payload
        },
        context: undefined
    };

    data.event.header.messageId = createMessageId();

    response.send(data);
});

alexaDeviceHandlers.set('Alexa.SmartVision.ObjectDetectionSensor/SetObjectDetectionClasses', async (request, response, directive: any, device: ScryptedDevice & ObjectDetector) => {
    const supportedType = supportedTypes.get(device.type);
    if (!supportedType)
        return;

    const { header, endpoint, payload } = directive;
    const detectionTypes = await device.getObjectTypes();

    const data: Response = {
        "event": {
            header,
            endpoint,
            payload: {}
        },
        "context": {
            "properties": [{
                "namespace": "Alexa.SmartVision.ObjectDetectionSensor",
                "name": "objectDetectionClasses",
                "value": detectionTypes.classes.map(type => ({
                    "imageNetClass": type
                })),
                timeOfSample: new Date().toISOString(),
                uncertaintyInMilliseconds: 0
            }]
        }
    };

    data.event.header.name = "Response";
    data.event.header.messageId = createMessageId();

    sendDeviceResponse(data, response, device);
});