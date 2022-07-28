import pathToFfmpeg from 'ffmpeg-static';
import { BufferConverter, BufferConvertorOptions, DeviceManager, FFmpegInput, MediaManager, MediaObject, MediaObjectOptions, MediaStreamUrl, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes, ScryptedNativeId, SystemDeviceState, SystemManager } from "@scrypted/types";
import axios from 'axios';
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import https from 'https';
import mimeType from 'mime';
import mkdirp from "mkdirp";
import Graph from 'node-dijkstra';
import os from 'os';
import path from 'path';
import rimraf from "rimraf";
import tmp from 'tmp';
import MimeType from 'whatwg-mimetype';
import { MediaObjectRemote } from "./plugin-api";

function typeMatches(target: string, candidate: string): boolean {
    // candidate will accept anything
    if (candidate === '*' || target === '*')
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
    extraConverters: BufferConverter[] = [];

    constructor() {
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
            fromMimeType: ScryptedMimeTypes.SchemePrefix + 'file',
            toMimeType: ScryptedMimeTypes.MediaObject,
            convert: async (data, fromMimeType, toMimeType) => {
                const filename = data.toString();
                const ab = await fs.promises.readFile(filename);
                const mt = mimeType.lookup(data.toString());
                const mo = this.createMediaObject(ab, mt);
                return mo;
            }
        });

        this.builtinConverters.push({
            fromMimeType: ScryptedMimeTypes.Url,
            toMimeType: ScryptedMimeTypes.FFmpegInput,
            async convert(data, fromMimeType): Promise<Buffer> {
                const url = data.toString();
                const args: FFmpegInput = {
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

                const ret: FFmpegInput = Object.assign({
                    inputArguments,
                }, mediaUrl);

                if (mediaUrl.url.startsWith('rtsp')) {
                    ret.container = 'rtsp';
                    inputArguments.unshift(
                        "-rtsp_transport", "tcp",
                    );
                }

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
            convert: async (data, fromMimeType: string, toMimeType: string, options?: BufferConvertorOptions): Promise<Buffer> => {
                const console = this.getMixinConsole(options?.sourceId, undefined);

                const ffInput: FFmpegInput = JSON.parse(data.toString());

                const args = [
                    '-hide_banner',
                ];
                args.push(...ffInput.inputArguments);

                const tmpfile = tmp.fileSync();
                try {
                    args.push('-y', "-vframes", "1", '-f', 'image2', tmpfile.name);

                    const cp = child_process.spawn(await this.getFFmpegPath(), args);
                    console.log('converting ffmpeg input to image.');
                    // ffmpegLogInitialOutput(console, cp);
                    cp.on('error', (code) => {
                        console.error('ffmpeg error code', code);
                    })
                    const to = setTimeout(() => {
                        console.log('ffmpeg stream to image convesion timed out.');
                        cp.kill('SIGKILL');
                    }, 10000);
                    clearTimeout(to);
                    const [exitCode] = await once(cp, 'exit');
                    if (exitCode)
                        throw new Error(`ffmpeg stream to image convesion failed with exit code: ${exitCode}`);
                    return fs.readFileSync(tmpfile.name);
                }
                finally {
                    rimraf.sync(tmpfile.name);
                }
            }
        });
    }

    async addConverter(converter: BufferConverter): Promise<void> {
        this.extraConverters.push(converter);
    }

    async clearConverters(): Promise<void> {
        this.extraConverters = [];
    }

    async convertMediaObjectToJSON<T>(mediaObject: MediaObject, toMimeType: string): Promise<T> {
        const buffer = await this.convertMediaObjectToBuffer(mediaObject, toMimeType);
        return JSON.parse(buffer.toString());
    }

    abstract getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } };
    abstract getDeviceById<T>(id: string): T;
    abstract getPluginDeviceId(): string;
    abstract getMixinConsole(mixinId: string, nativeId: ScryptedNativeId): Console;

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
        return pathToFfmpeg || defaultPath;
    }

    async getFilesPath(): Promise<string> {
        const filesPath = process.env.SCRYPTED_PLUGIN_VOLUME;
        if (!filesPath)
            throw new Error('SCRYPTED_PLUGIN_VOLUME env variable not set?');
        const ret = path.join(filesPath, 'files');
        mkdirp.sync(ret);
        return ret;
    }

    getConverters(): BufferConverter[] {
        const converters = Object.entries(this.getSystemState())
            .filter(([id, state]) => state[ScryptedInterfaceProperty.interfaces]?.value?.includes(ScryptedInterface.BufferConverter))
            .map(([id]) => this.getDeviceById<BufferConverter>(id));

        // builtins should be after system converters. these should not be overriden by system,
        // as it could cause system instability with misconfiguration.
        converters.push(...this.builtinConverters);

        // extra converters are added last and do allow overriding builtins, as
        // the instability would be confined to a single plugin.
        converters.push(...this.extraConverters);
        return converters;
    }

    ensureMediaObjectRemote(mediaObject: string | MediaObject): MediaObjectRemote {
        if (typeof mediaObject === 'string') {
            const mime = mimeType.lookup(mediaObject);
            return this.createMediaObjectRemote(mediaObject, mime);
        }
        return mediaObject as MediaObjectRemote;
    }

    async convertMediaObject<T>(mediaObject: MediaObject, toMimeType: string): Promise<T> {
        const converted = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return converted.data;
    }

    async convertMediaObjectToInsecureLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.InsecureLocalUrl);
        return url.data.toString();
    }

    async convertMediaObjectToBuffer(mediaObject: MediaObject, toMimeType: string): Promise<Buffer> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return intermediate.data as Buffer;
    }
    async convertMediaObjectToLocalUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.LocalUrl);
        return url.data.toString();
    }
    async convertMediaObjectToUrl(mediaObject: string | MediaObject, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.Url);
        return url.data.toString();
    }

    createMediaObjectRemote(data: any | Buffer | Promise<string | Buffer>, mimeType: string, options?: MediaObjectOptions): MediaObjectRemote {
        if (typeof data === 'string')
            throw new Error('string is not a valid type. if you intended to send a url, use createMediaObjectFromUrl.');
        if (!mimeType)
            throw new Error('no mimeType provided');
        if (mimeType === ScryptedMimeTypes.MediaObject)
            return data;

        if (data.constructor?.name === Object.name)
            data = Buffer.from(JSON.stringify(data));

        const sourceId = typeof options?.sourceId === 'string' ? options?.sourceId : this.getPluginDeviceId();
        class MediaObjectImpl implements MediaObjectRemote {
            __proxy_props = {
                mimeType,
                sourceId,
            }

            mimeType = mimeType;
            sourceId = sourceId;
            async getData(): Promise<Buffer | string> {
                return Promise.resolve(data);
            }
        }
        return new MediaObjectImpl();
    }

    async createFFmpegMediaObject(ffMpegInput: FFmpegInput, options?: MediaObjectOptions): Promise<MediaObject> {
        return this.createMediaObjectRemote(Buffer.from(JSON.stringify(ffMpegInput)), ScryptedMimeTypes.FFmpegInput, options);
    }

    async createMediaObjectFromUrl(data: string, options?: MediaObjectOptions): Promise<MediaObject> {
        const url = new URL(data);
        const scheme = url.protocol.slice(0, -1);
        const mimeType = ScryptedMimeTypes.SchemePrefix + scheme;

        const sourceId = typeof options?.sourceId === 'string' ? options?.sourceId : this.getPluginDeviceId();
        class MediaObjectImpl implements MediaObjectRemote {
            __proxy_props = {
                mimeType,
                sourceId,
            }

            mimeType = mimeType;
            sourceId = sourceId;
            async getData(): Promise<Buffer | string> {
                return Promise.resolve(data);
            }
        }
        return new MediaObjectImpl();
    }

    async createMediaObject(data: any, mimeType: string, options?: MediaObjectOptions): Promise<MediaObject> {
        return this.createMediaObjectRemote(data, mimeType, options);
    }

    async convert(converters: BufferConverter[], mediaObject: MediaObjectRemote, toMimeType: string): Promise<{ data: Buffer | string | any, mimeType: string }> {
        // console.log('converting', mediaObject.mimeType, toMimeType);
        const mediaMime = new MimeType(mediaObject.mimeType);
        const outputMime = new MimeType(toMimeType);

        if (mimeMatches(mediaMime, outputMime)) {
            return {
                mimeType: outputMime.essence,
                data: await mediaObject.getData(),
            }
        }

        let sourceId = mediaObject?.sourceId;
        if (typeof sourceId !== 'string')
            sourceId = this.getPluginDeviceId();
        const console = this.getMixinConsole(sourceId, undefined);

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

                // edge matches
                if (mimeMatches(mediaMime, inputMime)) {
                    const weight = parseFloat(inputMime.parameters.get('converter-weight'));
                    // catch all converters should be heavily weighted so as not to use them.
                    mediaNode[targetId] = weight || (inputMime.essence === '*/*' ? 1000 : 1);
                }

                // target output matches
                if (mimeMatches(outputMime, convertedMime) || converter.toMimeType === ScryptedMimeTypes.MediaObject) {
                    const weight = parseFloat(inputMime.parameters.get('converter-weight'));
                    // catch all converters should be heavily weighted so as not to use them.
                    node['output'] = weight || (convertedMime.essence === ScryptedMimeTypes.MediaObject ? 1000 : 1);
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

            if (converter.toMimeType === ScryptedMimeTypes.MediaObject) {
                const mo = await converter.convert(value, valueMime.essence, toMimeType, { sourceId }) as MediaObject;
                const found = await this.convertMediaObjectToBuffer(mo, toMimeType);
                return {
                    data: found,
                    mimeType: mo.mimeType,
                };
            }

            value = await converter.convert(value, valueMime.essence, targetMimeType, { sourceId }) as string | Buffer;
            valueMime = new MimeType(targetMimeType);
        }

        return {
            data: value,
            mimeType: valueMime.essence,
        };
    }
}

export class MediaManagerImpl extends MediaManagerBase {
    constructor(public systemManager: SystemManager, public deviceManager: DeviceManager) {
        super();
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState; }; } {
        return this.systemManager.getSystemState();
    }

    getDeviceById<T>(id: string): T {
        return this.systemManager.getDeviceById<T>(id);
    }

    getPluginDeviceId(): string {
        return this.deviceManager.getDeviceState().id;
    }

    getMixinConsole(mixinId: string, nativeId: string): Console {
        if (typeof mixinId !== 'string')
            return this.deviceManager.getDeviceConsole(nativeId);
        return this.deviceManager.getMixinConsole(mixinId, nativeId);
    }
}

export class MediaManagerHostImpl extends MediaManagerBase {
    constructor(public pluginDeviceId: string,
        public getSystemState: () => { [id: string]: { [property: string]: SystemDeviceState } },
        public console: Console,
        public getDeviceById: (id: string) => any) {
        super();
    }

    getPluginDeviceId(): string {
        return this.pluginDeviceId;
    }

    getMixinConsole(mixinId: string, nativeId: string): Console {
        return this.console;
    }
}
