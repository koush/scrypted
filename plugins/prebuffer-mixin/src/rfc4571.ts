import { ParserOptions, ParserSession } from "@scrypted/common/src/ffmpeg-rebroadcast";
import { readLength } from "@scrypted/common/src/read-stream";
import sdk, { MediaObject, MediaStreamOptions } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import net from 'net';
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";


const { mediaManager } = sdk;

export function connectRFC4571Parser(url: string) {
    const u = new URL(url);
    if (!u.protocol.startsWith('tcp'))
        throw new Error('rfc4751 url must be tcp');

    const socket = net.connect(parseInt(u.port), u.hostname);
    return socket;
}


export async function startRFC4571Parser(socket: net.Socket, sdp: string, mediaStreamOptions: MediaStreamOptions, hasRstpPrefix?: boolean, options?: ParserOptions<"rtsp">): Promise<ParserSession<"rtsp">> {
    let isActive = true;
    const events = new EventEmitter();

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

    const setupActivityTimer = (container: string) => {
        let dataTimeout: NodeJS.Timeout;

        function dataKill() {
            console.error('timeout waiting for data, killing parser session', container);
            kill();
        }

        function resetActivityTimer() {
            if (!options.timeout)
                return;
            clearTimeout(dataTimeout);
            dataTimeout = setTimeout(dataKill, options.timeout);
        }

        events.once('killed', () => clearTimeout(dataTimeout));

        resetActivityTimer();
        return {
            resetActivityTimer,
        }
    }


    (async () => {
        const { resetActivityTimer } = setupActivityTimer('rtsp');

        while (true) {
            let header: Buffer;
            let length: number;
            if (hasRstpPrefix) {
                header = await readLength(socket, 4);
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

    return {
        sdp: Promise.resolve([Buffer.from(sdp)]),
        inputAudioCodec: mediaStreamOptions.audio.codec,
        inputVideoCodec: mediaStreamOptions.video.codec,
        inputVideoResolution: undefined,
        isActive() { return isActive },
        kill,
        mediaStreamOptions,
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