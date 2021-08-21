import { RTCAVMessage, BufferConverter, FFMpegInput, MediaManager, MediaObject, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, SystemManager } from "@scrypted/sdk/types";
import { convert, ensureBuffer } from "../convert";
import { MediaObjectRemote } from "./plugin-api";
import mimeType from 'mime'
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import tmp from 'tmp';
import net from 'net';
import { sleep } from "../sleep";
import { AddressInfo } from "ws";

const wrtc = require('wrtc');
Object.assign(global, wrtc);
const { RTCVideoSource, RTCAudioSource } = wrtc.nonstandard;

const rtcSessions: { [id: string]: RTCPeerConnection } = {};

async function listenZeroCluster(server: net.Server) {
    while (true) {
        const port = 10000 + Math.round(Math.random() * 30000);
        server.listen(port);
        try {
            await once(server, 'listening');
            return (server.address() as AddressInfo).port;
        }
        catch (e) {
        }
    }
}

function addBuiltins(converters: BufferConverter[]) {
    converters.push({
        fromMimeType: ScryptedMimeTypes.Url + ';' + ScryptedMimeTypes.AcceptUrlParameter,
        toMimeType: ScryptedMimeTypes.FFmpegInput,
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const args: FFMpegInput = {
                inputArguments: ['-i', data.toString()]
            }

            return Buffer.from(JSON.stringify(args));
        }
    });

    converters.push({
        fromMimeType: ScryptedMimeTypes.FFmpegInput,
        toMimeType: 'image/jpeg',
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const ffInput: FFMpegInput = JSON.parse(data.toString());

            const args = [];
            args.push(...ffInput.inputArguments);


            const tmpfile = tmp.fileSync();
            args.push('-y', "-vf", "select=eq(n\\,1)", "-vframes", "1", '-f', 'singlejpeg', tmpfile.name);

            const cp = child_process.spawn("ffmpeg", args, {
                // stdio: 'ignore',
            });
            cp.stdout.on('data', data => console.log(data.toString()));
            cp.stderr.on('data', data => console.error(data.toString()));
            cp.on('error', (code) => {
                console.error('ffmpeg error code', code);
            })
            await once(cp, 'exit');
            const ret = fs.readFileSync(tmpfile.name);
            return ret;
        }
    });

    converters.push({
        fromMimeType: ScryptedMimeTypes.RTCAVAnswer,
        toMimeType: ScryptedMimeTypes.RTCAVOffer,
        async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const rtcInput: RTCAVMessage = JSON.parse(data.toString());
            const { id } = rtcInput;
            const pc = rtcSessions[id];
            if (!pc.remoteDescription)
                await pc.setRemoteDescription(rtcInput.description);
            for (const candidate of rtcInput.candidates) {
                pc.addIceCandidate(candidate);
            }
            const ret: RTCAVMessage = {
                id,
                candidates: null,
                description: null,
                configuration: null,
            };
            return Buffer.from(JSON.stringify(ret));
        }
    });

    converters.push({
        fromMimeType: ScryptedMimeTypes.FFmpegInput,
        toMimeType: ScryptedMimeTypes.RTCAVOffer,
        async convert(ffInputBuffer: string | Buffer, fromMimeType: string): Promise<Buffer | string> {
            const ffInput: FFMpegInput = JSON.parse(ffInputBuffer.toString());

            const configuration: RTCConfiguration = {
                iceServers: [
                    {
                        urls: ["turn:turn0.clockworkmod.com", "turn:n0.clockworkmod.com", "turn:n1.clockworkmod.com"],
                        username: "foo",
                        credential: "bar",
                    },
                ],
            };

            const pc = new RTCPeerConnection(configuration);

            pc.onicecandidate = evt => {
                ret.candidates.push(evt.candidate);
            }

            const videoSource = new RTCVideoSource();
            pc.addTrack(videoSource.createTrack());
            const audioSource = new RTCAudioSource();
            pc.addTrack(audioSource.createTrack());

            const videoServer = net.createServer(async (socket) => {
                videoServer.close()
                const res = await resolution;
                const width = parseInt(res[2]);
                const height = parseInt(res[3]);
                const toRead = parseInt(res[2]) * parseInt(res[3]) * 1.5;
                socket.on('readable', () => {
                    while (true) {
                        const buffer: Buffer = socket.read(toRead);
                        if (!buffer)
                            return;
                        const data = new Uint8ClampedArray(buffer);
                        const frame = { width, height, data };
                        try {
                            videoSource.onFrame(frame)
                        }
                        catch (e) {
                            cp.kill();
                            console.error(e);
                        }
                    }
                });
            });
            const videoPort = await listenZeroCluster(videoServer);

            const audioServer = net.createServer(async (socket) => {
                audioServer.close()
                const { sample_rate, channels } = await sampleInfo;
                const bitsPerSample = 16;
                const channelCount = channels[1] === 'mono' ? 1 : 2;
                const sampleRate = parseInt(sample_rate[1]);

                const toRead = sampleRate / 100 * channelCount * 2;
                socket.on('readable', () => {
                    while (true) {
                        const buffer: Buffer = socket.read(toRead);
                        if (!buffer)
                            return;
    
                        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + toRead)
                        const samples = new Int16Array(ab);  // 10 ms of 16-bit mono audio
    
                        const data = {
                            samples,
                            sampleRate,
                            bitsPerSample,
                            channelCount,
                        };
                        try {
                            audioSource.onData(data);
                        }
                        catch (e) {
                            cp.kill();
                            console.error(e);
                        }
                    }
                });
            });
            const audioPort = await listenZeroCluster(audioServer);

            const args = [];
            args.push('-y');
            args.push(...ffInput.inputArguments);
            args.push('-vcodec', 'none');
            args.push('-acodec', 'pcm_s16le');
            args.push('-f', 's16le');
            args.push(`tcp://127.0.0.1:${audioPort}`);
            args.push('-vcodec', 'rawvideo');
            args.push('-acodec', 'none');
            args.push('-pix_fmt', 'yuv420p');
            args.push('-f', 'rawvideo');
            args.push(`tcp://127.0.0.1:${videoPort}`);

            const cp = child_process.spawn('ffmpeg', args, {
                // stdio: 'ignore',
            });
            cp.on('error', e => console.error('ffmpeg error', e));
            cp.stdout.on('data', data => console.log(data.toString()));
            cp.stderr.on('data', data => console.error(data.toString()));

            const resolution = new Promise<Array<string>>(resolve => {
                cp.stdout.on('data', data => {
                    const stdout = data.toString();
                    const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
                    if (res)
                        resolve(res);
                });
                cp.stderr.on('data', data => {
                    const stdout = data.toString();
                    const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
                    if (res)
                        resolve(res);
                });
            });

            interface SampleInfo {
                sample_rate: string[];
                channels: string[];
            }

            const sampleInfo = new Promise<SampleInfo>(resolve => {
                const parser = (data: Buffer) => {
                    const stdout = data.toString();
                    const sample_rate = /([0-9]+) Hz/i.exec(stdout)
                    const channels = /Audio:.* (stereo|mono)/.exec(stdout)
                    if (sample_rate && channels) {
                        resolve({
                            sample_rate, channels,
                        });
                    }
                };
                cp.stdout.on('data', parser);
                cp.stderr.on('data', parser);
            });

            const id = Math.random().toString();
            rtcSessions[id] = pc;
            const checkConn = () => {
                if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
                    delete rtcSessions[id];
                    cp.kill();
                }
            }

            pc.onconnectionstatechange = checkConn;
            pc.oniceconnectionstatechange = checkConn;

            setTimeout(() => {
                if (pc.connectionState !== 'connected') {
                    pc.close();
                    cp.kill();
                }
            }, 60000);

            const offer = await pc.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false,
            });
            await pc.setLocalDescription(offer);

            const ret: RTCAVMessage = {
                id,
                candidates: [],
                description: offer,
                configuration,
            }

            await sleep(2000);

            return Buffer.from(JSON.stringify(ret));
        }
    })
}


export class MediaManagerImpl implements MediaManager {
    systemManager: SystemManager;

    constructor(systemManager: SystemManager) {
        this.systemManager = systemManager;
    }

    getConverters(): BufferConverter[] {
        const devices = Object.keys(this.systemManager.getSystemState()).map(id => this.systemManager.getDeviceById(id));
        const converters = Object.values(devices).filter(device => device.interfaces?.includes(ScryptedInterface.BufferConverter))
            .map(device => device as ScryptedDevice & BufferConverter);
        addBuiltins(converters);
        return converters;
    }

    ensureMediaObjectRemote(mediaObject: string | MediaObject): MediaObjectRemote {
        if (typeof mediaObject === 'string') {
            const mime = mimeType.lookup(mediaObject);
            return this.createMediaObject(mediaObject, mime);
        }
        return mediaObject as MediaObjectRemote;
    }

    async convertMediaObjectToInsecureLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.InsecureLocalUrl);
        return url.data.toString();
    }

    async convertMediaObjectToBuffer(mediaObject: string | MediaObject, toMimeType: string): Promise<Buffer> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return ensureBuffer(intermediate.data);
    }
    async convertMediaObjectToLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.LocalUrl);
        return url.data.toString();
    }
    async convertMediaObjectToUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await convert(this.getConverters(), converted, ScryptedMimeTypes.Url);
        return url.data.toString();
    }
    createFFmpegMediaObject(ffMpegInput: FFMpegInput): MediaObject {
        const mimeType = ScryptedMimeTypes.FFmpegInput;
        const json = JSON.stringify(ffMpegInput);

        class MediaObjectImpl implements MediaObjectRemote {
            __proxy_props = {
                mimeType,
            }

            mimeType = mimeType;
            async getData(): Promise<Buffer> {
                return Buffer.from(json);
            }
        }
        return new MediaObjectImpl();
    }

    createMediaObject(data: string | Buffer | Promise<string | Buffer>, mimeType: string): MediaObjectRemote {
        class MediaObjectImpl implements MediaObjectRemote {
            __proxy_props = {
                mimeType,
            }

            mimeType = mimeType;
            async getData(): Promise<Buffer | string> {
                return Promise.resolve(data);
            }
        }
        return new MediaObjectImpl();
    }
}
