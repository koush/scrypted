import { cloneDeep } from "@scrypted/common/src/clone-deep";
import { ParserOptions, ParserSession, setupActivityTimer } from "@scrypted/common/src/ffmpeg-rebroadcast";
import { read16BELengthLoop, readLength } from "@scrypted/common/src/read-stream";
import { findH264NaluType, H264_NAL_TYPE_SPS, RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";
import { parseSdp } from "@scrypted/common/src/sdp-utils";
import { sleep } from "@scrypted/common/src/sleep";
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { ResponseMediaStreamOptions } from "@scrypted/sdk";
import net from 'net';
import { EventEmitter, Readable } from "stream";
import { getSpsResolution, parse as spsParse } from "./sps-parser";

export function connectRFC4571Parser(url: string) {
    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
        throw new Error('rfc4751 url must be tcp');

    const socket = net.connect(parseInt(u.port), u.hostname);
    return socket;
}

export type RtspChannelCodecMapping = { [key: number]: string };

const RTSP_BUFFER = Buffer.from('RTSP');

export function startRFC4571Parser(console: Console, socket: Readable, sdp: string, mediaStreamOptions: ResponseMediaStreamOptions, options?: ParserOptions<"rtsp">, rtspOptions?: {
    channelMap: RtspChannelCodecMapping,
    handleRTSP: () => Promise<void>,
    onLoop?: () => void,
}): ParserSession<"rtsp"> {
    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', e => console.error('rebroadcast error', e));

    const parsedSdp = parseSdp(sdp);
    const audioSection = parsedSdp.msections.find(msection => msection.type === 'audio');
    const videoSection = parsedSdp.msections.find(msection => msection.type === 'video');
    const audioPt = audioSection?.payloadTypes?.[0];
    const videoPt = videoSection?.payloadTypes?.[0];

    const inputAudioCodec = audioSection?.codec;
    const inputVideoCodec = videoSection.codec;

    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    const kill = () => {
        if (isActive) {
            events.emit('killed');
            events.emit('error', new Error('killed'));
        }
        isActive = false;
        sessionKilled();
        socket.destroy();
    };

    socket.on('close', kill);
    socket.on('error', kill);

    const { resetActivityTimer } = setupActivityTimer('rtsp', kill, events, options?.timeout);

    let inputVideoResolution: {
        width: number;
        height: number;
    };

    const sprop = videoSection
        ?.fmtp?.[0]?.parameters?.['sprop-parameter-sets'];
    const sdpSps = sprop?.split(',')?.[0];
    // const sdpPps = sprop?.split(',')?.[1];

    if (sdpSps) {
        try {
            const sps = Buffer.from(sdpSps, 'base64');
            const parsedSps = spsParse(sps);
            inputVideoResolution = getSpsResolution(parsedSps);
            console.log('parsed sdp sps', parsedSps);
        }
        catch (e) {
            console.warn('sdp sps parsing failed');
        }
    }

    (async () => {
        // don't start parsing until next tick, to prevent missed packets.
        await sleep(0);

        const headerLength = rtspOptions?.channelMap ? 4 : 2;
        const offset = rtspOptions?.channelMap ? 2 : 0;
        const skipHeader = (header: Buffer, resumeRead: () => void) => {
            if (header.compare(RTSP_BUFFER))
                return false;
            socket.unshift(header);
            rtspOptions.handleRTSP().then(resumeRead);
            return true;
        }
        await read16BELengthLoop(socket, {
            headerLength,
            offset,
            skipHeader,
            callback: (header, data) => {
                let type: string;

                rtspOptions?.onLoop?.();

                if (rtspOptions?.channelMap) {
                    const channel = header.readUInt8(1);
                    type = rtspOptions?.channelMap[channel];
                    if (!type) {
                        const rtpType = rtspOptions?.channelMap[channel - 1];
                        if (rtpType)
                            type = `rtcp-${rtpType}`;
                    }
                }
                else {
                    const pt = data[1] & 0x7f;

                    const prefix = Buffer.alloc(2);
                    prefix[0] = RTSP_FRAME_MAGIC;
                    if (pt === audioPt) {
                        prefix[1] = 0;
                    }
                    else if (pt === videoPt) {
                        prefix[1] = 2;
                    }
                    header = Buffer.concat([prefix, header]);

                    if (pt === audioPt)
                        type = inputAudioCodec;
                    else if (pt === videoPt)
                        type = inputVideoCodec;
                }

                const chunk: StreamChunk = {
                    chunks: [header, data],
                    type,
                };

                if (!inputVideoResolution) {
                    const sps = findH264NaluType(chunk, H264_NAL_TYPE_SPS);
                    if (sps) {
                        try {
                            const parsedSps = spsParse(sps);
                            inputVideoResolution = getSpsResolution(parsedSps);
                            console.log(inputVideoResolution);
                            console.log('parsed bitstream sps', parsedSps);
                        }
                        catch (e) {
                            console.warn('sps parsing failed');
                            inputVideoResolution = {
                                width: NaN,
                                height: NaN,
                            }
                        }
                    }
                }

                events.emit('rtsp', chunk);
                resetActivityTimer();
            }
        });
    })()
        .catch(e => {
            throw e;
        })
        .finally(kill);


    return {
        sdp: Promise.resolve([Buffer.from(sdp)]),
        inputAudioCodec,
        inputVideoCodec,
        get inputVideoResolution() {
            return inputVideoResolution;
        },
        get isActive() { return isActive },
        kill,
        killed,
        resetActivityTimer,
        negotiateMediaStream: (requestMediaStream) => {
            const ret: ResponseMediaStreamOptions = cloneDeep(mediaStreamOptions) || {
                id: undefined,
                name: undefined,
            };

            if (!ret.video)
                ret.video = {};

            ret.video.codec = inputVideoCodec;

            // some rtsp like unifi offer alternate audio tracks (aac and opus).
            if (requestMediaStream?.audio?.codec && requestMediaStream?.audio?.codec !== inputAudioCodec) {
                const alternateAudio = parsedSdp.msections.find(msection => msection.type === 'audio' && msection.codec === requestMediaStream?.audio?.codec);
                if (alternateAudio) {
                    ret.audio = {
                        codec: requestMediaStream?.audio?.codec,
                    };

                    return ret;
                }
            }

            // reported codecs may be wrong/cached/etc, so before blindly copying the audio codec info,
            // verify what was found.
            if (ret?.audio?.codec === inputAudioCodec) {
                ret.audio = mediaStreamOptions?.audio;
            }
            else {
                ret.audio = {
                    codec: inputAudioCodec,
                }
            }

            return ret;
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
}