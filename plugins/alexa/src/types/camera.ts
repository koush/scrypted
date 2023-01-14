import { HttpResponse, MotionSensor, RTCAVSignalingSetup, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import { addSupportedType, AlexaCapabilityHandler, capabilityHandlers, EventReport, StateReport } from "./common";
import { createMessageId } from "../message";
import { Capability } from "alexa-smarthome-ts/lib/skill/Capability";
import { DisplayCategory } from "alexa-smarthome-ts";

export function getCameraCapabilities(device: ScryptedDevice): Capability<any>[] {
    const capabilities: Capability<any>[] = [
        {
            "type": "AlexaInterface",
            "interface": "Alexa.RTCSessionController",
            "version": "3",
            "configuration": {
                isFullDuplexAudioSupported: true,
            }
        } as any,
    ];

    if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
        capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa.MotionSensor",
                "version": "3",
                "properties": {
                    "supported": [
                        {
                            "name": "detectionState"
                        }
                    ],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            },
        )
    }

    return capabilities;
}

addSupportedType(ScryptedDeviceType.Camera, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.RTCSignalingChannel))
            return;

        const capabilities = getCameraCapabilities(device);

        return {
            displayCategories: ['CAMERA'],
            capabilities
        }
    },
    async reportState(device: ScryptedDevice & MotionSensor): Promise<StateReport> {
        return {
            type: 'state',
            namespace: 'Alexa',
            name: 'StateReport',
            context: {
                "properties": [
                    {
                        "namespace": "Alexa.MotionSensor",
                        "name": "detectionState",
                        "value": device.motionDetected ? "DETECTED" : "NOT_DETECTED",
                        "timeOfSample": new Date().toISOString(),
                        "uncertaintyInMilliseconds": 0
                    }
                ]
            }
        };
    },
    async sendEvent(eventSource: ScryptedDevice & MotionSensor, eventDetails, eventData): Promise<EventReport> {
        if (eventDetails.eventInterface !== ScryptedInterface.MotionSensor)
            return undefined;

        return {
            type: 'event',
            namespace: 'Alexa',
            name: 'ChangeReport',
            payload: {
                change: {
                    cause: {
                        type: "PHYSICAL_INTERACTION"
                    },
                    properties: [
                        {
                            "namespace": "Alexa.MotionSensor",
                            "name": "detectionState",
                            "value": eventData ? "DETECTED" : "NOT_DETECTED",
                            "timeOfSample": new Date().toISOString(),
                            "uncertaintyInMilliseconds": 0
                        }
                    ]
                }
            },
        };
    }
});

export const rtcHandlers = new Map<string, AlexaCapabilityHandler<any>>();

export class AlexaSignalingSession implements RTCSignalingSession {
    constructor(public response: HttpResponse, public directive: any) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return {
            proxy: true,
            offer: {
                type: 'offer',
                sdp: this.directive.payload.offer.value,
            },
            disableTrickle: true,
            // this could be a low resolution screen, no way of knowing, so never send a
            // 1080p+ stream.
            screen: {
                width: 1280,
                height: 720,
            }
        }
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        if (type !== 'offer')
            throw new Error('Alexa only supports RTC offer');
        if (sendIceCandidate)
            throw new Error("Alexa does not support trickle ICE");
        return {
            type: 'offer',
            sdp: this.directive.payload.offer.value,
        }
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        throw new Error("Alexa does not support trickle ICE");
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
        this.response.send(JSON.stringify({
            "event": {
                "header": {
                    "namespace": "Alexa.RTCSessionController",
                    "name": "AnswerGeneratedForSession",
                    "messageId": createMessageId(),
                    "payloadVersion": "3"
                },
                "payload": {
                    "answer": {
                        "format": "SDP",
                        "value": description.sdp,
                    }
                }
            }
        }));
    }
}

rtcHandlers.set('InitiateSessionWithOffer', async (request, response, directive: any,
    device: ScryptedDevice & RTCSignalingChannel) => {
    const session = new AlexaSignalingSession(response, directive);
    const control = await device.startRTCSignalingSession(session);
    control.setPlayback({
        audio: true,
        video: false,
    })
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
                "messageId": createMessageId(),
                "payloadVersion": "3"
            },
            "payload": {
                sessionId,
            }
        }
    };

    response.send(JSON.stringify(body));
});
