import { RTCRtpTransceiver } from "@koush/werift";
import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput, Intercom, RTCSessionControl } from "@scrypted/sdk";

const { mediaManager } = sdk;

export class ScryptedSessionControl implements RTCSessionControl {
    rtspServer: RtspServer;
    killed = new Deferred<void>();

    constructor(public intercom: Intercom, public audioTransceiver: RTCRtpTransceiver) {
    }

    async setPlayback(options: { audio: boolean; video: boolean; }) {
        if (!this.intercom)
            return;

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
            inputArguments: [
                '-rtsp_transport', 'udp',
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


        const rtspServer = new RtspServer(client, sdp, true);
        this.rtspServer = rtspServer;
        // rtspServer.console = console;
        await rtspServer.handlePlayback();
        const parsedSdp = parseSdp(rtspServer.sdp);
        const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;

        track.onReceiveRtp.subscribe(rtpPacket => {
            rtpPacket.header.payloadType = 110;
            rtspServer.sendTrack(audioTrack, rtpPacket.serialize(), false);
        });
    }

    async getRefreshAt() {
    }
    async extendSession() {
    }

    async endSession() {
        this.rtspServer?.client.destroy();
        this.killed.resolve(undefined);
    }
}
