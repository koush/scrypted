import { ParserSession, setupActivityTimer } from "@scrypted/common/src/ffmpeg-rebroadcast";
import { closeQuiet, createBindZero } from "@scrypted/common/src/listen-cluster";
import { findH264NaluType, H264_NAL_TYPE_SPS, parseSemicolonDelimited, RtspClient, RtspClientUdpSetupOptions, RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";
import { parseSdp } from "@scrypted/common/src/sdp-utils";
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { ResponseMediaStreamOptions } from "@scrypted/sdk";
import dgram from 'dgram';
import { parse as spsParse } from "h264-sps-parser";
import { EventEmitter } from "stream";
import { negotiateMediaStream } from "./rfc4571";
import { getSpsResolution } from "./sps-resolution";

export type RtspChannelCodecMapping = { [key: number]: string };

export interface RtspSessionParserSpecific {
    interleaved: Map<string, number>;
}

export async function startRtspSession(console: Console, url: string, mediaStreamOptions: ResponseMediaStreamOptions, options: {
    useUdp: boolean,
    audioSoftMuted: boolean,
    rtspRequestTimeout: number,
}): Promise<ParserSession<"rtsp">> {
    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', e => console.error('rebroadcast error', e));

    let servers: dgram.Socket[] = [];
    const rtspClient = new RtspClient(url);
    rtspClient.console = console;
    rtspClient.requestTimeout = options.rtspRequestTimeout;

    const cleanupSockets = () => {
        for (const server of servers) {
            closeQuiet(server);
        }
        rtspClient.safeTeardown();
    }

    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    const kill = (error?: Error) => {
        if (isActive) {
            events.emit('killed');
            events.emit('error', error || new Error('killed'));
        }
        isActive = false;
        sessionKilled();
        cleanupSockets();
    };

    rtspClient.client.on('close', () => {
        kill(new Error('rtsp socket closed'));
    });
    rtspClient.client.on('error', e => {
        kill(e);
    });

    const { resetActivityTimer } = setupActivityTimer('rtsp', kill, events, options?.rtspRequestTimeout);

    try {
        await rtspClient.options();
        const sdpResponse = await rtspClient.describe();
        const contentBase = sdpResponse.headers['content-base'];
        if (contentBase) {
            const url = new URL(contentBase, rtspClient.url);
            const existing = new URL(rtspClient.url);
            for (const p of existing.searchParams) {
                url.searchParams.append(p[0], p[1]);
            }
            url.username = existing.username;
            url.password = existing.password;
            rtspClient.url = url.toString();
        }
        let sdp = sdpResponse.body.toString().trim();
        console.log('sdp', sdp);

        const parsedSdp = parseSdp(sdp);
        let channel = 0;
        const mapping: RtspChannelCodecMapping = {};
        let udpSessionTimeout: number;
        const { useUdp } = options;
        const checkUdpSessionTimeout = (headers: { [key: string]: string }) => {
            if (useUdp && headers.session && !udpSessionTimeout) {
                const sessionDict = parseSemicolonDelimited(headers.session);
                udpSessionTimeout = parseInt(sessionDict['timeout']);
            }
        }

        let parserSpecific: RtspSessionParserSpecific;
        if (!useUdp) {
            parserSpecific = {
                interleaved: new Map(),
            }
        }

        const doSetup = async (control: string, codec: string) => {
            let udp: dgram.Socket;
            if (useUdp) {
                const rtspChannel = channel;

                const setup: RtspClientUdpSetupOptions = {
                    path: control,
                    type: 'udp',
                    onRtp: (header, data) => {
                        const prefix = Buffer.alloc(4);
                        prefix.writeUInt8(RTSP_FRAME_MAGIC, 0);
                        prefix.writeUInt8(rtspChannel, 1);
                        prefix.writeUInt16BE(data.length, 2);
                        const chunk: StreamChunk = {
                            chunks: [prefix, data],
                            type: codec,
                        };
                        events.emit('rtsp', chunk);
                        resetActivityTimer?.();
                    },
                };
                const setupResult = await rtspClient.setup(setup);
                udp = setup.dgram;
                checkUdpSessionTimeout(setupResult.headers);

                const punch = Buffer.alloc(1);
                const transport = setupResult.headers['transport'];
                const match = transport.match(/.*?server_port=([0-9]+)-([0-9]+)/);
                const [_, rtp, rtcp] = match;
                const rtpPort = parseInt(rtp);
                // have seen some servers return a server_port 0. should watch for bad data in any case.
                if (rtpPort) {
                    const { hostname } = new URL(rtspClient.url);
                    udp.send(punch, rtpPort, hostname)
                }
                mapping[channel] = codec;
            }
            else {
                const setupResult = await rtspClient.setup({
                    path: control,
                    type: 'tcp',
                    port: channel,
                    onRtp: (header, data) => {
                        const chunk: StreamChunk = {
                            chunks: [header, data],
                            type: codec,
                        };
                        events.emit('rtsp', chunk);
                        resetActivityTimer?.();
                    },
                });

                const resultChannel = setupResult.interleaved ? setupResult.interleaved.begin : channel;
                mapping[resultChannel] = codec;
                parserSpecific.interleaved.set(codec, resultChannel);
            }

            channel += 2;
        }

        let setupVideoSection = false;

        parsedSdp.msections = parsedSdp.msections.filter(section => {
            if (section.type === 'video') {
                if (setupVideoSection) {
                    console.warn('additional video section found. skipping.');
                    return false;
                }
                setupVideoSection = true;
            }
            else if (section.type !== 'audio') {
                console.warn('unknown section', section.type);
                return false;
            }
            else if (options.audioSoftMuted) {
                return false;
            }
            return true;
        });

        for (const section of parsedSdp.msections) {
            await doSetup(section.control, section.codec)
        }

        // sdp may contain multiple audio/video sections. take only the first video section.
        sdp = [...parsedSdp.header.lines, ...parsedSdp.msections.map(msection => msection.lines).flat()].join('\r\n');

        // don't start parsing until next tick when this function returns to allow
        // event handlers to be set prior to parsing.
        const start = async () => {
            try {
                await rtspClient.play();
                rtspClient.console = undefined;
                await rtspClient.readLoop();
            }
            catch (e) {
                kill(e);
            }
            finally {
                kill(new Error('rtsp read loop exited'));
            }
        };

        // this return block is intentional, to ensure that the remaining code happens sync.
        return (() => {
            const audioSection = parsedSdp.msections.find(msection => msection.type === 'audio');
            const videoSection = parsedSdp.msections.find(msection => msection.type === 'video');

            if (!videoSection)
                throw new Error('SDP does not contain a video section!');

            const inputAudioCodec = audioSection?.codec;
            const inputVideoCodec = videoSection.codec;


            let inputVideoResolution: {
                width: number;
                height: number;
            };

            const probeStart = Date.now();
            const probe = (chunk: StreamChunk) => {
                if (Date.now() - probeStart > 6000)
                    events.removeListener('rtsp', probe);
                const sps = findH264NaluType(chunk, H264_NAL_TYPE_SPS);
                if (sps) {
                    try {
                        const parsedSps = spsParse(sps);
                        inputVideoResolution = getSpsResolution(parsedSps);
                        // console.log(inputVideoResolution);
                        console.log('parsed bitstream sps', inputVideoResolution);
                    }
                    catch (e) {
                        console.warn('sps parsing failed');
                        inputVideoResolution = {
                            width: NaN,
                            height: NaN,
                        }
                    }
                    events.removeListener('rtsp', probe);
                }
            }

            if (!inputVideoResolution)
                events.on('rtsp', probe);

            const sprop = videoSection
                ?.fmtp?.[0]?.parameters?.['sprop-parameter-sets'];
            const sdpSps = sprop?.split(',')?.[0];
            // const sdpPps = sprop?.split(',')?.[1];

            if (sdpSps) {
                try {
                    const sps = Buffer.from(sdpSps, 'base64');
                    const parsedSps = spsParse(sps);
                    inputVideoResolution = getSpsResolution(parsedSps);
                    console.log('parsed sdp sps', inputVideoResolution);
                }
                catch (e) {
                    console.warn('sdp sps parsing failed');
                }
            }

            return {
                parserSpecific,
                start,
                sdp: Promise.resolve([Buffer.from(sdp)]),
                inputAudioCodec,
                inputVideoCodec,
                get inputVideoResolution() {
                    return inputVideoResolution;
                },
                get isActive() { return isActive },
                kill(error?: Error) {
                    kill(error);
                },
                killed,
                resetActivityTimer,
                negotiateMediaStream: (requestMediaStream) => {
                    return negotiateMediaStream(sdp, mediaStreamOptions, inputVideoCodec, inputAudioCodec, requestMediaStream);
                },
                emit(container: 'rtsp', chunk: StreamChunk) {
                    events.emit(container, chunk);
                    return this;
                },
                on(event: string, cb: any) {
                    events.on(event, cb);
                    return this;
                },
                once(event: any, cb: any) {
                    events.once(event, cb);
                    return this;
                },
                removeListener(event, cb) {
                    events.removeListener(event, cb);
                    return this;
                }
            }
        })();
    }
    catch (e) {
        cleanupSockets();
        throw e;
    }
}
