import { Deferred } from "@scrypted/common/src/deferred";
import { parseSdp } from "@scrypted/common/src/sdp-utils";
import { sleep } from "@scrypted/common/src/sleep";
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { AVFormatContext, createAVFormatContext } from '@scrypted/libav';
import { ResponseMediaStreamOptions } from "@scrypted/sdk";
import { once } from 'events';
import net from 'net';
import { EventEmitter } from "stream";
import tls from 'tls';
import { RTSP_FRAME_MAGIC } from "../../../common/src/rtsp-server";
import { ParserSession, setupActivityTimer } from "./ffmpeg-session";
import { installLibavAddon } from "./libav-setup";
import { negotiateMediaStream } from "./rfc4571";

let installPromise: Promise<void>;

export async function startLibavSession(console: Console, url: string, mediaStreamOptions: ResponseMediaStreamOptions, options: {
    useUdp: boolean,
    audioSoftMuted: boolean,
    activityTimeout: number,
}): Promise<ParserSession<"rtsp">> {
    installPromise ||= installLibavAddon();
    await installPromise;

    const formatContext = createAVFormatContext();
    try {
        return await startLibavSessionWrapped(formatContext, console, url, mediaStreamOptions, options);
    }
    catch (e) {
        await formatContext.close();
        throw e;
    }
}

export async function startLibavSessionWrapped(formatContext: AVFormatContext, console: Console, url: string, mediaStreamOptions: ResponseMediaStreamOptions, options: {
    useUdp: boolean,
    audioSoftMuted: boolean,
    activityTimeout: number,
}): Promise<ParserSession<"rtsp">> {
    const events = new EventEmitter();

    let tlsProxy: net.Server;
    try {
        if (url.startsWith('rtsps:') || url.startsWith('https:')) {
            let { hostname, port } = new URL(url);
            if (!port) {
                if (url.startsWith('rtsps:'))
                    port = '322';
                else
                    port = '443';
            }

            const portNumber = parseInt(port);
            if (!portNumber)
                throw new Error('invalid port number');

            tlsProxy = net.createServer(async socket => {
                try {
                    const tlsSocket = tls.connect({
                        host: hostname,
                        port: portNumber,
                        rejectUnauthorized: false,
                    });
                    await once(tlsSocket, 'secureConnect');
                    socket.pipe(tlsSocket).pipe(socket);
                }
                catch (e) {
                    console.error('tls proxy error', e);
                    socket.destroy();
                }
            });

            tlsProxy.listen(0, '127.0.0.1');
            await once(tlsProxy, 'listening');
            const localPort = (tlsProxy.address() as net.AddressInfo).port;
            // rewrite the url to use the local port
            const u = new URL(url);
            u.protocol = u.protocol.replace('s:', ':');
            u.hostname = '127.0.0.1';
            u.port = localPort.toString();
            url = u.toString();
        }

        await formatContext.open(url, {
            rtsp_transport: options.useUdp ? 'udp' : 'tcp',
        });
    }
    catch (e) {
        tlsProxy?.close();
        throw e;
    }

    let sdp = formatContext.createSDP();
    const parsedSdp = parseSdp(sdp);
    // sdp may contain multiple audio/video sections. take only the first video section.
    sdp = [...parsedSdp.header.lines, ...parsedSdp.msections.map(msection => msection.lines).flat()].join('\r\n');

    const killDeferred = new Deferred<void>();
    const startDeferred = new Deferred<void>();
    killDeferred.promise.catch(e => {
        events.emit('killed');
        events.emit('error', e);
        tlsProxy?.close();
    });

    const kill = (e?: Error) => {
        killDeferred.reject(e || new Error('killed'));
        startDeferred.reject(e || new Error('killed'));
    }

    const { resetActivityTimer } = setupActivityTimer('rtsp', kill, events, options?.activityTimeout);

    (async () => {
        const pipelines: {
            streamIndex: number,
            writeFormatContext: AVFormatContext,
        }[] = [];

        try {
            await startDeferred.promise;
            formatContext.streams.forEach(stream => {
                if (options.audioSoftMuted && stream.type === 'audio')
                    return;
                if (stream.type !== 'video' && stream.type !== 'audio')
                    return;

                const { codec } = stream;
                const rtp = createAVFormatContext();
                rtp.create('rtp', rtp => {
                    const prefix = Buffer.alloc(4);
                    prefix.writeUInt8(RTSP_FRAME_MAGIC, 0);
                    prefix.writeUInt8(stream.index, 1);
                    prefix.writeUInt16BE(rtp.length, 2);

                    const chunk: StreamChunk = {
                        chunks: [prefix, rtp],
                        type: codec === 'hevc' ? 'h265' : codec,
                    };

                    events.emit('rtsp', chunk);
                });
                rtp.newStream({
                    formatContext,
                    streamIndex: stream.index,
                });

                pipelines.push({
                    streamIndex: stream.index,
                    writeFormatContext: rtp,
                });
            });

            while (!killDeferred.finished) {
                using result = await formatContext.receiveFrame(pipelines);
                if (result)
                    resetActivityTimer();
                if (killDeferred.finished)
                    break;
            }
        }
        catch (e) {
            kill(e);
        }
        finally {
            kill(new Error('rtsp read loop exited'));

            await sleep(1000);
            await Promise.allSettled(pipelines.map(pipeline => pipeline.writeFormatContext.close()));
            await sleep(1000);
            await formatContext.close();
        }
    })();

    return {
        start: () => {
            startDeferred.resolve();
        },
        sdp: Promise.resolve(sdp),
        get isActive() { return !killDeferred.finished },
        kill(error?: Error) {
            kill(error);
        },
        killed: killDeferred.promise,
        resetActivityTimer,
        negotiateMediaStream: (requestMediaStream, inputVideoCodec, inputAudioCodec) => {
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
}