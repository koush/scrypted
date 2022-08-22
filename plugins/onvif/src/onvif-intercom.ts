import sdk, { MediaObject, Intercom, FFmpegInput, ScryptedMimeTypes } from "@scrypted/sdk";
import { RtspSmartCamera } from "../../rtsp/src/rtsp";
import { parseSemicolonDelimited, RtspClient } from "@scrypted/common/src/rtsp-server";
import { parseSdp } from "@scrypted/common/src/sdp-utils";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import child_process from 'child_process';

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

const codecRegex = /a=rtpmap:(\d+) (.*?)\/(\d+)/g
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

export class OnvifIntercom implements Intercom {
    intercomClient: RtspClient;
    url: string;

    constructor(public camera: RtspSmartCamera) {
    }

    async startIntercom(media: MediaObject) {
        await this.stopIntercom();

        const username = this.camera.storage.getItem("username");
        const password = this.camera.storage.getItem("password");
        const url = new URL(this.url);
        url.username = username;
        url.password = password;
        this.intercomClient = new RtspClient(url.toString());
        this.intercomClient.console = this.camera.console;
        await this.intercomClient.options();
        const Require = 'www.onvif.org/ver20/backchannel';

        const describe = await this.intercomClient.describe({
            Require,
        });
        this.camera.console.log('ONVIF Backchannel SDP:');
        this.camera.console.log(describe.body?.toString());
        const parsedSdp = parseSdp(describe.body.toString());
        const audioBackchannel = parsedSdp.msections.find(msection => msection.type === 'audio' && msection.direction === 'sendonly');
        if (!audioBackchannel)
            throw new Error('ONVIF audio backchannel not found');

        const rtp = Math.round(10000 + Math.random() * 30000);
        const rtcp = rtp + 1;

        const headers: any = {
            Require,
            Transport: `RTP/AVP;unicast;client_port=${rtp}-${rtcp}`,
        };

        const response = await this.intercomClient.request('SETUP', headers, audioBackchannel.control);
        const transportDict = parseSemicolonDelimited(response.headers.transport);
        this.intercomClient.session = response.headers.session.split(';')[0];

        this.camera.console.log('backchannel transport', transportDict);

        const { server_port } = transportDict;
        const serverPorts = server_port.split('-');
        const serverRtp = parseInt(serverPorts[0]);

        const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

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

        const ssrcBuffer = Buffer.from(transportDict.ssrc, 'hex');
        // ffmpeg expects ssrc as signed int32.
        const ssrc = ssrcBuffer.readInt32BE(0);

        const args = [
            '-hide_banner',
            ...ffmpegInput.inputArguments,
            '-vn',
            '-acodec', codec.ffmpegCodec,
            '-ar', match.sampleRate,
            '-ac', match.channels || '1',
            "-payload_type", match.payloadType,
            "-ssrc", ssrc.toString(),
            '-f', 'rtp',
            `rtp://${this.camera.getIPAddress()}:${serverRtp}?localrtpport=${rtp}&localrtcpport=${rtcp}`,
        ];
        safePrintFFmpegArguments(this.camera.console, args);
        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);

        ffmpegLogInitialOutput(this.camera.console, cp);

        await this.intercomClient.play();
        this.camera.console.log('intercom playing');
    }

    async stopIntercom() {
        this.intercomClient?.client?.destroy();
        this.intercomClient = undefined;
    }
}