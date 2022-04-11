import { cloneDeep } from "@scrypted/common/src/clone-deep";
import { ParserOptions, ParserSession, setupActivityTimer } from "@scrypted/common/src/ffmpeg-rebroadcast";
import { readLength } from "@scrypted/common/src/read-stream";
import { RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";
import { findTrackByType, parseSdp } from "@scrypted/common/src/sdp-utils";
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import sdk, { ResponseMediaStreamOptions } from "@scrypted/sdk";
import net from 'net';
import { EventEmitter, Readable } from "stream";


const { mediaManager } = sdk;

export function connectRFC4571Parser(url: string) {
    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
        throw new Error('rfc4751 url must be tcp');

    const socket = net.connect(parseInt(u.port), u.hostname);
    return socket;
}

export type RtspChannelCodecMapping = { [key: number]: string };

export async function startRFC4571Parser(console: Console, socket: Readable, sdp: string, mediaStreamOptions: ResponseMediaStreamOptions, options?: ParserOptions<"rtsp">, rtspMapping?: RtspChannelCodecMapping): Promise<ParserSession<"rtsp">> {
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

    (async () => {
        while (true) {
            let header: Buffer;
            let length: number;
            let type: string;

            if (rtspMapping) {
                header = await readLength(socket, 4);
                length = header.readUInt16BE(2);
                const channel = header.readUInt8(1);
                type = rtspMapping[channel];
            }
            else {
                header = await readLength(socket, 2);
                length = header.readUInt16BE(0);
            }

            const data = await readLength(socket, length);
            const pt = data[1] & 0x7f;

            if (!rtspMapping) {
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
            events.emit('rtsp', chunk);
            resetActivityTimer();
        }
    })()
        .finally(kill);


    return {
        sdp: Promise.resolve([Buffer.from(sdp)]),
        inputAudioCodec,
        inputVideoCodec,
        inputVideoResolution: undefined,
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