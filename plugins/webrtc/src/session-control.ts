import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput, Intercom, MediaObject, RTCSessionControl } from "@scrypted/sdk";
import { WebRTCConnectionManagement } from "./ffmpeg-to-wrtc";
import type { SFrameAudioReceiver } from "./sframe";

const { mediaManager } = sdk;

export class ScryptedSessionControl implements RTCSessionControl {
    rtspServer: RtspServer;
    killed = new Deferred<void>();

    constructor(public connectionManagement: WebRTCConnectionManagement, public intercom: Intercom,
        public updateSFrameReceiveKeys?: RTCSessionControl['updateSFrameReceiveKeys'],
        private readonly sframeAudioReceiver?: SFrameAudioReceiver) {
        this.killed.promise.finally(async () => {
            this.rtspServer?.client.destroy();
            try {
                await this.intercom?.stopIntercom();
            }
            catch (e) {
            }
        });
    }

    private findTwoWayAudioTransceiver() {
        const isTwoWay = (direction?: string) => direction === 'sendrecv' || direction === 'recvonly';
        return this.connectionManagement.pc.getTransceivers().find(t =>
            t.receiver.track.kind === 'audio' && (isTwoWay(t.offerDirection) || isTwoWay(t.currentDirection)));
    }

    async setPlayback(options: { audio: boolean | 'on-demand'; video: boolean; }): Promise<void> {
        await this.setPlaybackInternal(options);

        if (options.audio === 'on-demand') {
            const audioTransceiver = this.findTwoWayAudioTransceiver();
            const track = audioTransceiver?.receiver?.track;
            if (!track)
                return;
            track.onReceiveRtp.allUnsubscribe();
            track.onReceiveRtp.subscribe(async rtpPacket => {
                track.onReceiveRtp.allUnsubscribe();

                await this.setPlaybackInternal({
                    audio: true,
                    video: options.video,
                });

                // disable on timeout?
            });
        }
    }

    async setPlaybackInternal(options: { audio: boolean | 'on-demand'; video: boolean; }): Promise<MediaObject> {
        if (this.killed.finished)
            return;

        if (!this.intercom)
            return;

        const audioTransceiver = this.findTwoWayAudioTransceiver();
        if (!audioTransceiver)
            return;
        if (!audioTransceiver.receiver.track)
            await audioTransceiver.onTrack.asPromise()
        const track = audioTransceiver.receiver.track;

        track.onReceiveRtp.allUnsubscribe();
        await this.intercom.stopIntercom();

        if (options.audio !== true) {
            return;
        }

        this.rtspServer?.client.destroy();

        const rtspTcpServer = await listenZeroSingleClient('127.0.0.1');

        const url = rtspTcpServer.url.replace('tcp:', 'rtsp:');
        const ffmpegInput: FFmpegInput = {
            container: 'rtsp',
            url,
            mediaStreamOptions: {
                id: undefined,
                video: null,
            },
            inputArguments: [
                '-analyzeduration', '0',
                '-probesize', '512',
                '-rtsp_transport', 'tcp',
                '-i', url,
            ],
        };


        const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput);
        rtspTcpServer.clientPromise.then(async client => {
            const sdpReturnAudio = [
                "v=0",
                "o=- 0 0 IN IP4 127.0.0.1",
                "s=" + "WebRTC Audio Talkback",
                "c=IN IP4 127.0.0.1",
                "t=0 0",
                "b=AS:24",

                // HACK, this may not be opus
                "m=audio 0 RTP/AVP 110",
                "a=rtpmap:110 opus/48000/2",
                "a=fmtp:110 minptime=10;useinbandfec=1",

                // "m=audio 0 RTP/AVP 0",
                // "a=rtpmap:0 PCMU/8000",

                // "m=audio 0 RTP/AVP 8",
                // "a=rtpmap:8 PCMA/8000",
            ];
            let sdp = sdpReturnAudio.join('\r\n');
            sdp = createSdpInput(0, 0, sdp);


            const rtspServer = new RtspServer(client, sdp);
            this.rtspServer = rtspServer;
            rtspServer.console = console;
            await rtspServer.handlePlayback();
            const parsedSdp = parseSdp(rtspServer.sdp);
            const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;

            let lastSFrameError = 0;
            track.onReceiveRtp.subscribe(rtpPacket => {
                if (this.killed.finished)
                    return;
                let payload: Buffer;
                try {
                    payload = this.sframeAudioReceiver
                        ? this.sframeAudioReceiver.receive(rtpPacket.payload, rtpPacket.header.ssrc)
                        : rtpPacket.payload;
                }
                catch (error) {
                    // Avoid flooding the console on a missing key or damaged stream.
                    if (Date.now() - lastSFrameError > 5000) {
                        lastSFrameError = Date.now();
                        console.warn('WebRTC talkback SFrame packet dropped', error);
                    }
                    return;
                }
                const output = rtpPacket.clone();
                output.payload = payload;
                output.header.payloadType = 110;
                rtspServer.sendTrack(audioTrack, output.serialize(), false);
            });
        });

        await this.intercom.startIntercom(mo);
        await rtspTcpServer.clientPromise;
        return mo;
    }

    async getRefreshAt() {
    }
    async extendSession() {
    }

    async endSession() {
        this.killed.resolve(undefined);
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        await this.connectionManagement.pc.setRemoteDescription(description);
    }

    async createLocalDescription(type: "offer" | "answer"): Promise<RTCSessionDescriptionInit> {
        if (type === 'answer') {
            const answer = await this.connectionManagement.pc.createAnswer();
            await this.connectionManagement.pc.setLocalDescription(answer);
            return answer.toSdp();
        }
        else {
            const offer = await this.connectionManagement.pc.createOffer();
            await this.connectionManagement.pc.setLocalDescription(offer);
            return offer.toSdp();
        }
    }
}
