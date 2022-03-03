import { ParserOptions, ParserSession, setupActivityTimer } from "@scrypted/common/src/ffmpeg-rebroadcast";
import { readLength, readLine } from "@scrypted/common/src/read-stream";
import sdk, { MediaObject, MediaStreamOptions } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import net from 'net';
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { parseHeaders, readMessage, RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";
import { findTrack } from "@scrypted/common/src/sdp-utils";


const { mediaManager } = sdk;

export function connectRFC4571Parser(url: string) {
    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
        throw new Error('rfc4751 url must be tcp');

    const socket = net.connect(parseInt(u.port), u.hostname);
    return socket;
}


export async function startRFC4571Parser(console: Console, socket: net.Socket, sdp: string, mediaStreamOptions: MediaStreamOptions, hasRstpPrefix?: boolean, options?: ParserOptions<"rtsp">): Promise<ParserSession<"rtsp">> {
    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', e => console.error('rebroadcast error', e));

    const audioPt = parseInt((sdp as string).match(/m=audio.* ([0-9]+)/)?.[1]);
    const videoPt = parseInt((sdp as string).match(/m=video.* ([0-9]+)/)?.[1]);

    const kill = () => {
        if (isActive) {
            events.emit('killed');
            events.emit('error', new Error('killed'));
        }
        isActive = false;
        socket.destroy();
    };

    socket.on('close', kill);
    socket.on('error', kill);

    (async () => {
        const { resetActivityTimer } = setupActivityTimer('rtsp', kill, events, options?.timeout);

        while (true) {
            let header: Buffer;
            let length: number;
            if (hasRstpPrefix) {
                header = await readLength(socket, 4);
                // rtsp over tcp will actually interleave RTSP request/responses
                // within the RTSP data stream. The only way to tell if it's a request/response
                // is to see if the header + data starts with RTSP/1.0 message line.
                // Or RTSP, if looking at only the header bytes. Then grab the response out.
                if (header.toString() === 'RTSP') {
                    const response = parseHeaders(await readMessage(socket));
                    const cl = parseInt(response['content-length']);
                    if (cl)
                        await readLength(socket, cl);
                    continue;
                }

                length = header.readUInt16BE(2);
            }
            else {
                header = await readLength(socket, 2);
                length = header.readUInt16BE(0);
            }
            const data = await readLength(socket, length);

            if (!hasRstpPrefix) {
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
            }

            const chunk: StreamChunk = {
                chunks: [header, data],
            }
            events.emit('rtsp', chunk);
            resetActivityTimer();
        }
    })()
        .finally(kill);

    let inputAudioCodec = mediaStreamOptions.audio.codec;
    let inputVideoCodec = mediaStreamOptions.video.codec;
    const audio = findTrack(sdp, 'audio');
    const video = findTrack(sdp, 'video');
    if (audio) {
        const lc = audio.section.toLowerCase();
        if (lc.includes('mpeg4'))
            inputAudioCodec = 'aac';
        else if (lc.includes('pcm'))
            inputAudioCodec = 'pcm';
    }
    if (video) {
        if (video.section.toLowerCase().includes('h264'))
            inputVideoCodec = 'h264';
    }

    return {
        sdp: Promise.resolve([Buffer.from(sdp)]),
        inputAudioCodec,
        inputVideoCodec,
        inputVideoResolution: undefined,
        isActive() { return isActive },
        kill,
        mediaStreamOptions,
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