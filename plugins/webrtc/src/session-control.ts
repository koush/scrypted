import { RTCRtpTransceiver } from "./werift";
import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput, Intercom, MediaObject, RTCSessionControl } from "@scrypted/sdk";

const { mediaManager } = sdk;

export class ScryptedSessionControl implements RTCSessionControl {
    rtspServer: RtspServer;
    killed = new Deferred<void>();

    constructor(public intercom: Intercom, public audioTransceiver: RTCRtpTransceiver) {
        this.killed.promise.finally(async () => {
            this.rtspServer?.client.destroy();
            try {
                await this.intercom?.stopIntercom();
            }
            catch (e) {
            }
        });
    }

    async setPlayback(options: { audio: boolean; video: boolean; }): Promise<void> {
        await this.setPlaybackInternal(options);
    }

    async setPlaybackInternal(options: { audio: boolean; video: boolean; }): Promise<MediaObject> {
        if (this.killed.finished)
            return;

        if (!this.intercom)
            return;

        if (!this.audioTransceiver.receiver.track)
            await this.audioTransceiver.onTrack.asPromise()
        const track = this.audioTransceiver.receiver.track;

        track.onReceiveRtp.allUnsubscribe();
        await this.intercom.stopIntercom();

        if (!options.audio) {
            return;
        }

        this.rtspServer?.client.destroy();

        const rtspTcpServer = await listenZeroSingleClient();

        const url = rtspTcpServer.url.replace('tcp:', 'rtsp:');
        const ffmpegInput: FFmpegInput = {
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
        await this.intercom.startIntercom(mo);

        const client = await rtspTcpServer.clientPromise;

        const sdpReturnAudio = [
            "v=0",
            "o=- 0 0 IN IP4 127.0.0.1",
            "s=" + "WebRTC Audio Talkback",
            "c=IN IP4 127.0.0.1",
            "t=0 0",
            "m=audio 0 RTP/AVP 110",
            "b=AS:24",
            // HACK, this may not be opus
            "a=rtpmap:110 opus/48000/2",
            "a=fmtp:101 minptime=10;useinbandfec=1",
        ];
        let sdp = sdpReturnAudio.join('\r\n');
        sdp = createSdpInput(0, 0, sdp);


        const rtspServer = new RtspServer(client, sdp);
        this.rtspServer = rtspServer;
        // rtspServer.console = console;
        await rtspServer.handlePlayback();
        const parsedSdp = parseSdp(rtspServer.sdp);
        const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;

        track.onReceiveRtp.subscribe(rtpPacket => {
            rtpPacket.header.payloadType = 110;
            rtspServer.sendTrack(audioTrack, rtpPacket.serialize(), false);
        });
        
        return mo;
    }

    async getRefreshAt() {
    }
    async extendSession() {
    }

    async endSession() {
        this.killed.resolve(undefined);
    }
}
