import sdk, { MediaObject, Intercom, FFMpegInput, ScryptedMimeTypes } from "@scrypted/sdk";
import { RtspSmartCamera } from "../../rtsp/src/rtsp";
import { RtspClient } from "@scrypted/common/src/rtsp-server";
import { findTrack } from "@scrypted/common/src/sdp-utils";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import child_process from 'child_process';

const { mediaManager, systemManager, deviceManager } = sdk;

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
        await this.intercomClient.options();
        const Require = 'www.onvif.org/ver20/backchannel';

        const describe = await this.intercomClient.describe({
            Require,
        });
        const audioBackchannel = findTrack(describe.body.toString(), 'audio', ['sendonly']);
        if (!audioBackchannel)
            throw new Error('ONVIF audio backchannel not found');


        this.camera.console.log('audio back channel track:', audioBackchannel);

        const rtp = Math.round(10000 + Math.random() * 30000);
        const rtcp = rtp + 1;

        const headers: any = {
            Require,
            Transport: `RTP/AVP;unicast;client_port=${rtp}-${rtcp}`,
        };

        if (this.intercomClient.session)
            headers['Session'] = this.intercomClient.session;

        const response = await this.intercomClient.request('SETUP', headers, audioBackchannel.trackId);
        const { transport } = response.headers;
        const transportDict: { [key: string]: string } = {};
        for (const part of transport.split(';')) {
            const [key, value] = part.split('=', 2);
            transportDict[key] = value;
        }

        this.camera.console.log('backchannel transport', transportDict);

        const { server_port } = transportDict;
        const serverPorts = server_port.split('-');
        const serverRtp = parseInt(serverPorts[0]);
        const serverRtcp = parseInt(serverPorts[1]);

        const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(media, ScryptedMimeTypes.FFmpegInput);

        const args = [
            ...ffmpegInput.inputArguments,
            '-vn',
            '-acodec', 'pcm_mulaw',
            '-ar', '8000',
            '-ac', '1',
            "-payload_type", '0',
            "-ssrc", parseInt(transportDict.ssrc, 16).toString(),
            '-f', 'rtp',
            `rtp://${this.camera.getIPAddress()}:${serverRtp}?localrtpport=${rtp}&localrtcpport=${rtcp}`,
        ];
        safePrintFFmpegArguments(this.camera.console, args);
        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);

        ffmpegLogInitialOutput(this.camera.console, cp);

        const play = await this.intercomClient.play();
        this.camera.console.log('intercom playing');
    }

    async stopIntercom() {
        this.intercomClient?.client?.destroy();
        this.intercomClient = undefined;
    }
}