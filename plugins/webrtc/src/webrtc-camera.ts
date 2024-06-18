import { Intercom, MediaObject, RequestMediaStreamOptions, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingClient, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDeviceBase, VideoCamera } from "@scrypted/sdk";
import { WebRTCPlugin } from "./main";
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from "./wrtc-to-rtsp";

const useSdp = true;

export class WebRTCCamera extends ScryptedDeviceBase implements VideoCamera, RTCSignalingClient, RTCSignalingChannel, Intercom {
    pendingClient: (session: RTCSignalingSession) => void;
    intercom: Promise<Intercom>;

    constructor(public plugin: WebRTCPlugin, nativeId: string) {
        super(nativeId);
    }

    async startIntercom(media: MediaObject): Promise<void> {
        const intercom = await this.intercom;
        if (!intercom)
            throw new Error('no webrtc session')
        return intercom.startIntercom(media);
    }

    async stopIntercom(): Promise<void> {
        const intercom = await this.intercom;
        if (!intercom)
            throw new Error('no webrtc session')
        return intercom.stopIntercom();
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        const mediaStreamOptions = getRTCMediaStreamOptions('webrtc', 'WebRTC');

        // todo: sdk.fork
        const { mediaObject, getIntercom } = await createRTCPeerConnectionSource({
            mixinId: undefined,
            nativeId: this.nativeId,
            mediaStreamOptions,
            startRTCSignalingSession: session => this.startRTCSignalingSession(session),
            maximumCompatibilityMode: this.plugin.storageSettings.values.maximumCompatibilityMode,
        });

        this.intercom?.then(intercom => intercom.stopIntercom());
        this.intercom = getIntercom();

        return mediaObject;
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const mediaStreamOptions = getRTCMediaStreamOptions('webrtc', 'WebRTC');
        return [
            mediaStreamOptions,
        ];
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        if (!this.pendingClient)
            throw new Error('Browser client is not connected. Click "Stream Web Camera".');

        class CompletedSession implements RTCSignalingSession {
            __proxy_props = { 
                options: {},
            };
            options: {};

            async getOptions(): Promise<RTCSignalingOptions> {
                return {};
            }
            createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
                return session.createLocalDescription(type, setup, sendIceCandidate);
            }
            setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
                return session.setRemoteDescription(description, setup);
            }
            addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
                return session.addIceCandidate(candidate);
            }
        }

        this.pendingClient(new CompletedSession());
        this.pendingClient = undefined;

        return;
    }

    createRTCSignalingSession(): Promise<RTCSignalingSession> {
        return new Promise(resolve => {
            this.pendingClient = resolve;
        });
    }
}
