import { createBindZero } from "@scrypted/common/src/listen-cluster";
import { RtspClient, parseSemicolonDelimited } from "@scrypted/common/src/rtsp-server";
import { parseSdp } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput, Intercom, MediaObject, ScryptedMimeTypes } from "@scrypted/sdk";
import crypto from 'crypto';
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { nextSequenceNumber } from "../../homekit/src/types/camera/jitter-buffer";
import { RtspSmartCamera } from "../../rtsp/src/rtsp";
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';


const { mediaManager } = sdk;

interface SupportedCodec {
    ffmpegCodec: string;
    sdpName: string;
}

const supportedCodecs: SupportedCodec[] = [];
function addSupportedCodec(ffmpegCodec: string, sdpName: string) {
    supportedCodecs.push({
        ffmpegCodec,
        sdpName,
    });
}

// a=rtpmap:97 L16/8000
// a=rtpmap:100 L16/16000
// a=rtpmap:101 L16/48000
// a=rtpmap:8 PCMA/8000
// a=rtpmap:102 PCMA/16000
// a=rtpmap:103 PCMA/48000
// a=rtpmap:0 PCMU/8000
// a=rtpmap:104 PCMU/16000
// a=rtpmap:105 PCMU/48000
// a=rtpmap:106 /0
// a=rtpmap:107 /0
// a=rtpmap:108 /0
// a=rtpmap:109 MPEG4-GENERIC/8000
// a=rtpmap:110 MPEG4-GENERIC/16000
// a=rtpmap:111 MPEG4-GENERIC/48000

// this order is irrelevant, the order of preference is the sdp.
addSupportedCodec('pcm_mulaw', 'PCMU');
addSupportedCodec('pcm_alaw', 'PCMA');
addSupportedCodec('pcm_s16be', 'L16');
addSupportedCodec('adpcm_g726', 'G726');
addSupportedCodec('aac', 'MPEG4-GENERIC');

interface CodecMatch {
    payloadType: string;
    sdpName: string;
    sampleRate: string;
    channels: string;
}

const codecRegex = /a=rtpmap:\s*(\d+) (.*?)\/(\d+)/g
function* parseCodecs(audioSection: string): Generator<CodecMatch> {
    for (const match of audioSection.matchAll(codecRegex)) {
        const [_, payloadType, sdpName, sampleRate, _skip, channels] = match;
        yield {
            payloadType,
            sdpName,
            sampleRate,
            channels,
        }
    }
}

const Require = 'www.onvif.org/ver20/backchannel';

export class OnvifIntercom implements Intercom {
    intercomClient: RtspClient;
    url: string;

    constructor(public camera: RtspSmartCamera) {
    }

    async checkIntercom() {
        const username = this.camera.storage.getItem("username");
        const password = this.camera.storage.getItem("password");
        const url = new URL(this.url);
        url.username = username;
        url.password = password;
        const intercomClient = this.intercomClient = new RtspClient(url.toString());
        intercomClient.console = this.camera.console;
        await intercomClient.options();

        const describe = await intercomClient.describe({
            Require,
        });
        this.camera.console.log('ONVIF Backchannel SDP:');
        this.camera.console.log(describe.body?.toString());
        const parsedSdp = parseSdp(describe.body.toString());
        const audioBackchannel = parsedSdp.msections.find(msection => msection.type === 'audio' && msection.direction === 'sendonly');
        if (!audioBackchannel)
            throw new Error('ONVIF audio backchannel not found');

        return { audioBackchannel, intercomClient };
    }

    async startIntercom(media: MediaObject) {
        const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

        await this.stopIntercom();

        const { audioBackchannel, intercomClient } = await this.checkIntercom();
        if (!audioBackchannel)
            throw new Error('ONVIF audio backchannel not found');

        const rtpServer = await createBindZero('udp4');
        const rtp = rtpServer.port;
        const rtcp = rtp + 1;

        let ip: string;
        let serverRtp: number;
        let transportDict: ReturnType<typeof parseSemicolonDelimited>;
        let tcp = false;
        try {
            const headers: any = {
                Require,
                Transport: `RTP/AVP;unicast;client_port=${rtp}-${rtcp}`,
            };

            const response = await intercomClient.request('SETUP', headers, audioBackchannel.control);
            transportDict = parseSemicolonDelimited(response.headers.transport);
            intercomClient.session = response.headers.session.split(';')[0];
            ip = this.camera.getIPAddress();

            const { server_port } = transportDict;
            const serverPorts = server_port.split('-');
            serverRtp = parseInt(serverPorts[0]);
        }
        catch (e) {
            tcp = true;
            this.camera.console.error('onvif udp backchannel failed, falling back to tcp', e);

            const headers: any = {
                Require,
                Transport: `RTP/AVP/TCP;unicast;interleaved=0-1`,
            };

            const response = await intercomClient.request('SETUP', headers, audioBackchannel.control);
            transportDict = parseSemicolonDelimited(response.headers.transport);
            intercomClient.session = response.headers.session.split(';')[0];
            ip = '127.0.0.1';
            const server = await createBindZero('udp4');
            intercomClient.client.on('close', () => server.server.close());
            serverRtp = server.port;
            server.server.on('message', data => {
                intercomClient.send(data, 0);
            });
        }
        this.camera.console.log('backchannel transport', transportDict);

        const availableCodecs = [...parseCodecs(audioBackchannel.contents)];
        let match: CodecMatch;
        let codec: SupportedCodec;
        for (const supported of availableCodecs) {
            codec = supportedCodecs.find(check => check.sdpName?.toLowerCase() === supported.sdpName.toLowerCase());
            if (codec) {
                match = supported;
                break;
            }
        }

        if (!match)
            throw new Error('no supported codec was found for back channel');

        let ssrcBuffer: Buffer;
        if (transportDict.ssrc) {
            ssrcBuffer = Buffer.from(transportDict.ssrc, 'hex');
        }
        else {
            ssrcBuffer = crypto.randomBytes(4);
        }
        // ffmpeg expects ssrc as signed int32.
        const ssrc = ssrcBuffer.readInt32BE(0);
        const ssrcUnsigned = ssrcBuffer.readUint32BE(0);

        const payloadType = parseInt(match.payloadType);

        await intercomClient.play({
            Require,
        });

        let pending: RtpPacket;
        let seqNumber = 0;

        const forwarder = await startRtpForwarderProcess(console, ffmpegInput, {
            audio: {
                onRtp: (rtp) => {
                    // if (true) {
                    //     const p = RtpPacket.deSerialize(rtp);
                    //     p.header.payloadType = payloadType;
                    //     p.header.ssrc = ssrcUnsigned;
                    //     p.header.marker = true;
                    //     rtpServer.server.send(p.serialize(), serverRtp, ip);
                    //     return;
                    // }

                    const p = RtpPacket.deSerialize(rtp);

                    if (!pending) {
                        pending = p;
                        return;
                    }

                    if (pending.payload.length + p.payload.length < 1024) {
                        pending.payload = Buffer.concat([pending.payload, p.payload]);
                        return;
                    }

                    pending.header.payloadType = payloadType;
                    pending.header.ssrc = ssrcUnsigned;
                    pending.header.sequenceNumber = seqNumber;
                    seqNumber = nextSequenceNumber(seqNumber);
                    pending.header.marker = true;

                    if (!tcp)
                        rtpServer.server.send(pending.serialize(), serverRtp, ip);
                    else
                        intercomClient.send(pending.serialize(), 0);

                    pending = p;
                },
                codecCopy: codec.ffmpegCodec,
                payloadType,
                ssrc,
                packetSize: 1024,
                encoderArguments: [
                    '-acodec', codec.ffmpegCodec,
                    '-ar', match.sampleRate,
                    '-ac', match.channels || '1',
                ],
            }
        });

        intercomClient.client.on('close', () => forwarder.kill());
        forwarder.killPromise.finally(() => intercomClient?.client.destroy());

        this.camera.console.log('intercom playing');
    }

    async stopIntercom() {
        this.intercomClient?.client?.destroy();
        this.intercomClient = undefined;
    }
}