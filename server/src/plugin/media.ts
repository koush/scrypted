import { ScryptedInterfaceProperty, SystemDeviceState, MediaStreamUrl, VideoCamera, Camera, BufferConverter, FFMpegInput, MediaManager, MediaObject, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, SystemManager } from "@scrypted/types";
import { MediaObjectRemote } from "./plugin-api";
import mimeType from 'mime'
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import tmp from 'tmp';
import os from 'os';
import { getInstalledFfmpeg } from '@scrypted/ffmpeg'
import { ffmpegLogInitialOutput } from "../media-helpers";
import Graph from 'node-dijkstra';
import MimeType from 'whatwg-mimetype';
import axios from 'axios';
import https from 'https';

function typeMatches(target: string, candidate: string): boolean {
    // candidate will accept anything
    if (candidate === '*')
        return true;
    return target === candidate;
}

function mimeMatches(target: MimeType, candidate: MimeType) {
    return typeMatches(target.type, candidate.type) && typeMatches(target.subtype, candidate.subtype);
}

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
})

export abstract class MediaManagerBase implements MediaManager {
    builtinConverters: BufferConverter[] = [];

    constructor(public console: Console) {
        for (const h of ['http', 'https']) {
            this.builtinConverters.push({
                fromMimeType: ScryptedMimeTypes.SchemePrefix + h,
                toMimeType: ScryptedMimeTypes.MediaObject,
                convert: async (data, fromMimeType, toMimeType) => {
                    const ab = await axios.get(data.toString(), {
                        responseType: 'arraybuffer',
                        httpsAgent,
                    });
                    const mimeType = ab.headers['content-type'] || toMimeType;
                    const mo = this.createMediaObject(Buffer.from(ab.data), mimeType);
                    return mo;
                }
            });
        }

        this.builtinConverters.push({
            fromMimeType: `${ScryptedMimeTypes.Url};${ScryptedMimeTypes.AcceptUrlParameter}=true`,
            toMimeType: ScryptedMimeTypes.FFmpegInput,
            async convert(data, fromMimeType): Promise<Buffer> {
                const url = data.toString();
                const args: FFMpegInput = {
                    url,
                    inputArguments: [
                        '-i', url,
                    ],
                }

                return Buffer.from(JSON.stringify(args));
            }
        });

        this.builtinConverters.push({
            fromMimeType: ScryptedMimeTypes.FFmpegInput,
            toMimeType: ScryptedMimeTypes.MediaStreamUrl,
            async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
                return data;
            }
        });

        this.builtinConverters.push({
            fromMimeType: ScryptedMimeTypes.MediaStreamUrl,
            toMimeType: ScryptedMimeTypes.FFmpegInput,
            async convert(data, fromMimeType: string): Promise<Buffer> {
                const mediaUrl: MediaStreamUrl = JSON.parse(data.toString());

                const inputArguments: string[] = [
                    '-i', mediaUrl.url,
                ];

                if (mediaUrl.url.startsWith('rtsp://')) {
                    inputArguments.unshift(
                        "-rtsp_transport", "tcp",
                        "-max_delay", "1000000",
                    );
                }

                const ret: FFMpegInput = Object.assign({
                    inputArguments,
                }, mediaUrl);

                return Buffer.from(JSON.stringify(ret));
            }
        });

        this.builtinConverters.push({
            fromMimeType: 'image/*',
            toMimeType: 'image/*',
            convert: async (data, fromMimeType: string): Promise<Buffer> => {
                return data as Buffer;
            }
        });

        this.builtinConverters.push({
            fromMimeType: ScryptedMimeTypes.FFmpegInput,
            toMimeType: 'image/jpeg',
            convert: async (data, fromMimeType: string): Promise<Buffer> => {
                const ffInput: FFMpegInput = JSON.parse(data.toString());

                const args = [
                    '-hide_banner',
                ];
                args.push(...ffInput.inputArguments);

                const tmpfile = tmp.fileSync();
                args.push('-y', "-vframes", "1", '-f', 'image2', tmpfile.name);

                const cp = child_process.spawn(await this.getFFmpegPath(), args);
                ffmpegLogInitialOutput(console, cp);
                cp.on('error', (code) => {
                    console.error('ffmpeg error code', code);
                })
                const to = setTimeout(() => {
                    console.log('ffmpeg stream to image convesion timed out.');
                    cp.kill('SIGKILL');
                }, 10000);
                await once(cp, 'exit');
                clearTimeout(to);
                const ret = fs.readFileSync(tmpfile.name);
                return ret;
            }
        });
    }

    async convertMediaObjectToJSON<T>(mediaObject: MediaObject, toMimeType: string): Promise<T> {
        const buffer = await this.convertMediaObjectToBuffer(mediaObject, toMimeType);
        return JSON.parse(buffer.toString());
    }

    abstract getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } };
    abstract getDeviceById<T>(id: string): T;

    async getFFmpegPath(): Promise<string> {
        // try to get the ffmpeg path as a value of another variable
        // ie, in docker builds:
        //     export SCRYPTED_FFMPEG_PATH_ENV_VARIABLE=SCRYPTED_RASPBIAN_FFMPEG_PATH
        const v = process.env.SCRYPTED_FFMPEG_PATH_ENV_VARIABLE;
        if (v) {
            const f = process.env[v];
            if (f && fs.existsSync(f))
                return f;
        }

        // try to get the ffmpeg path from a variable
        // ie:
        //     export SCRYPTED_FFMPEG_PATH=/usr/local/bin/ffmpeg
        const f = process.env.SCRYPTED_FFMPEG_PATH;
        if (f && fs.existsSync(f))
            return f;

        const defaultPath = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        return getInstalledFfmpeg() || defaultPath;
    }

    getConverters(): BufferConverter[] {
        const converters = Object.entries(this.getSystemState())
            .filter(([id, state]) => state[ScryptedInterfaceProperty.interfaces]?.value?.includes(ScryptedInterface.BufferConverter))
            .map(([id]) => this.getDeviceById<BufferConverter>(id));
        converters.push(...this.builtinConverters);
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
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.InsecureLocalUrl);
        return url.data.toString();
    }

    async convertMediaObjectToBuffer(mediaObject: MediaObject, toMimeType: string): Promise<Buffer> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return intermediate.data as Buffer;
    }
    async convertMediaObjectToLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.LocalUrl);
        return url.data.toString();
    }
    async convertMediaObjectToUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObject(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.Url);
        return url.data.toString();
    }

    createFFmpegMediaObject(ffMpegInput: FFMpegInput): MediaObject {
        return this.createMediaObject(Buffer.from(JSON.stringify(ffMpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    createMediaObject(data: any | Buffer | Promise<string | Buffer>, mimeType: string): MediaObjectRemote {
        if (typeof data === 'string')
            throw new Error('string is not a valid type. if you intended to send a url, use createMediaObjectFromUrl.');
        if (!mimeType)
            throw new Error('no mimeType provided');

        if (data.constructor.name !== Buffer.name)
            data = Buffer.from(JSON.stringify(data));

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

    async createMediaObjectFromUrl(data: string): Promise<MediaObject> {
        const url = new URL(data);
        const scheme = url.protocol.slice(0, -1);
        const fromMimeType = ScryptedMimeTypes.SchemePrefix + scheme;
        return this.createMediaObject(data, fromMimeType);
    }

    async convert(converters: BufferConverter[], mediaObject: MediaObjectRemote, toMimeType: string): Promise<{ data: Buffer | string, mimeType: string }> {
        // console.log('converting', mediaObject.mimeType, toMimeType);
        const mediaMime = new MimeType(mediaObject.mimeType);
        const outputMime = new MimeType(toMimeType);

        if (mimeMatches(mediaMime, outputMime)) {
            return {
                mimeType: outputMime.essence,
                data: await mediaObject.getData(),
            }
        }

        const converterIds = new Map<BufferConverter, string>();
        const converterReverseids = new Map<string, BufferConverter>();
        let id = 0;
        for (const converter of converters) {
            const cid = (id++).toString();
            converterIds.set(converter, cid);
            converterReverseids.set(cid, converter);
        }

        const nodes: any = {};
        const mediaNode: any = {};
        nodes['mediaObject'] = mediaNode;
        nodes['output'] = {};
        for (const converter of converters) {
            try {
                const inputMime = new MimeType(converter.fromMimeType);
                const convertedMime = new MimeType(converter.toMimeType);
                const targetId = converterIds.get(converter);
                const node: any = nodes[targetId] = {};
                for (const candidate of converters) {
                    try {
                        const candidateMime = new MimeType(candidate.fromMimeType);
                        if (!mimeMatches(convertedMime, candidateMime))
                            continue;
                        const candidateId = converterIds.get(candidate);
                        node[candidateId] = 1;
                    }
                    catch (e) {
                        console.warn('skipping converter due to error', e)
                    }
                }

                if (mimeMatches(mediaMime, inputMime)) {
                    mediaNode[targetId] = 1;
                }
                if (mimeMatches(outputMime, convertedMime) || converter.toMimeType === ScryptedMimeTypes.MediaObject) {
                    node['output'] = 1;
                }
            }
            catch (e) {
                console.warn('skipping converter due to error', e)
            }
        }

        const graph = new Graph();
        for (const id of Object.keys(nodes)) {
            graph.addNode(id, nodes[id]);
        }

        const route = graph.path('mediaObject', 'output') as Array<string>;
        if (!route || !route.length)
            throw new Error('no converter found');
        // pop off the mediaObject start node, no conversion necessary.
        route.shift();
        // also remove the output node.
        route.splice(route.length - 1);
        let value = await mediaObject.getData();
        let valueMime = new MimeType(mediaObject.mimeType);
        for (const node of route) {
            const converter = converterReverseids.get(node);
            const converterToMimeType = new MimeType(converter.toMimeType);
            const converterFromMimeType = new MimeType(converter.fromMimeType);
            const type = converterToMimeType.type === '*' ? valueMime.type : converterToMimeType.type;
            const subtype = converterToMimeType.subtype === '*' ? valueMime.subtype : converterToMimeType.subtype;
            const targetMimeType = `${type}/${subtype}`;

            if (typeof value === 'string' && !converterFromMimeType.parameters.has(ScryptedMimeTypes.AcceptUrlParameter)) {
                const url = new URL(value);
                const scheme = url.protocol.slice(0, -1);
                const fromMimeType = ScryptedMimeTypes.SchemePrefix + scheme;
                for (const converter of this.getConverters()) {
                    if (converter.fromMimeType !== fromMimeType || converter.toMimeType !== ScryptedMimeTypes.MediaObject)
                        continue;

                    const mo = await converter.convert(value, fromMimeType, toMimeType) as MediaObject;
                    const found = await this.convertMediaObjectToBuffer(mo, toMimeType);
                    return {
                        data: found,
                        mimeType: mo.mimeType,
                    };
                }
                throw new Error(`no ${ScryptedInterface.BufferConverter} exists for scheme: ${scheme}`);
            }
            value = await converter.convert(value, valueMime.essence, targetMimeType) as string | Buffer;
            valueMime = new MimeType(targetMimeType);
        }

        return {
            data: value,
            mimeType: valueMime.essence,
        };
    }
}

export class MediaManagerImpl extends MediaManagerBase {
    constructor(public systemManager: SystemManager, console: Console) {
        super(console);
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState; }; } {
        return this.systemManager.getSystemState();
    }

    getDeviceById<T>(id: string): T {
        return this.systemManager.getDeviceById<T>(id);
    }
}

export class MediaManagerHostImpl extends MediaManagerBase {
    constructor(public systemState: { [id: string]: { [property: string]: SystemDeviceState } },
        public getDeviceById: (id: string) => any,
        console: Console) {
        super(console);
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState; }; } {
        return this.systemState;
    }
}
