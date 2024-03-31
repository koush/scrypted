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

        const availableMatches = audioBackchannel.rtpmaps.filter(rtpmap => rtpmap.ffmpegEncoder);
        const defaultMatch = audioBackchannel.rtpmaps.find(rtpmap => rtpmap.ffmpegEncoder === 'pcm_mulaw') || audioBackchannel.rtpmaps.find(rtpmap => rtpmap.ffmpegEncoder);

        if (!defaultMatch)
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

        let { payloadType } = defaultMatch;

        await intercomClient.play({
            Require,
        });

        let pending: RtpPacket;
        let seqNumber = 0;

        const forwarder = await startRtpForwarderProcess(this.camera.console, ffmpegInput, {
            audio: {
                negotiate: async msection => {
                    const check = msection.rtpmap;
                    const channels = check.channels || 1;

                    return !!availableMatches.find(rtpmap => {
                        if (check.codec !== rtpmap.codec)
                            return false;
                        if (channels !== (rtpmap.channels || 1))
                            return false;
                        if (check.clock !== rtpmap.clock)
                            return false;
                        payloadType = check.payloadType;
                        // this default check should maybe be in sdp-utils.ts.
                        if (payloadType === undefined)
                            payloadType = 8;
                        return true;
                    });
                },
                onRtp: rtp => {
                    const p = RtpPacket.deSerialize(rtp);

                    if (!pending) {
                        pending = p;
                        return;
                    }

                    const elapsedRtpTimeMs = Math.abs(pending.header.timestamp - p.header.timestamp) / 8000 * 1000;
                    if (elapsedRtpTimeMs <= 160 && pending.payload.length + p.payload.length <= 1024) {
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
                codecCopy: 'ffmpeg',
                payloadType,
                ssrc,
                packetSize: 1024,
                encoderArguments: [
                    '-acodec', defaultMatch.ffmpegEncoder,
                    '-ar', defaultMatch.clock.toString(),
                    "-b:a", "64k",
                    '-ac', defaultMatch.channels?.toString() || '1',
                ],
            }
        });

        intercomClient.client.on('close', () => forwarder.kill());
        forwarder.killPromise.finally(() => intercomClient.safeTeardown());

        this.camera.console.log('intercom playing');
    }

    async stopIntercom() {
        this.intercomClient?.safeTeardown();
        this.intercomClient = undefined;
    }
}