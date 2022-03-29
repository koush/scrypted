import sdk, { RTCSessionControl, RTCSignalingClient, RTCSignalingSession, ScryptedDeviceBase, RTCAVSignalingSetup, RTCSignalingSendIceCandidate, VideoCamera, MediaObject, MediaStreamOptions, RequestMediaStreamOptions, RTCSignalingChannel, RTCSignalingOptions, Intercom } from "@scrypted/sdk"; import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from "./wrtc-to-rtsp";
const { mediaManager, systemManager, deviceManager } = sdk;

export class WebRTCCamera extends ScryptedDeviceBase implements VideoCamera, RTCSignalingClient, RTCSignalingChannel, Intercom {
    pendingClient: (session: RTCSignalingSession) => void;
    intercom: Promise<Intercom>;

    constructor(nativeId: string) {
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
        const mediaStreamOptions = getRTCMediaStreamOptions('webrtc', 'WebRTC', true);

        const { ffmpegInput, intercom } = await createRTCPeerConnectionSource({
            console: this.console,
            mediaStreamOptions,
            channel: this,
            useUdp: true,
        });

        this.intercom?.then(intercom => intercom.stopIntercom());
        this.intercom = intercom;

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        const mediaStreamOptions = getRTCMediaStreamOptions('webrtc', 'WebRTC', true);
        return [
            mediaStreamOptions,
        ];
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        if (!this.pendingClient)
            throw new Error('Browser client is not connected. Click "Stream Web Camera".');

        class CompletedSession implements RTCSignalingSession {
            async getOptions(): Promise<RTCSignalingOptions> {
                return;
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
