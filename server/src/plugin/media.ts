import { BufferConverter, DeviceManager, FFmpegInput, MediaManager, MediaObject as MediaObjectInterface, MediaObjectOptions, MediaStreamUrl, ScryptedDevice, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes, ScryptedNativeId, SystemDeviceState, SystemManager } from "@scrypted/types";
import axios from 'axios';
import pathToFfmpeg from 'ffmpeg-static';
import fs from 'fs';
import https from 'https';
import mimeType from 'mime';
import mkdirp from "mkdirp";
import Graph from 'node-dijkstra';
import os from 'os';
import path from 'path';
import MimeType from 'whatwg-mimetype';
import { RpcPeer } from "../rpc";
import { MediaObjectRemote } from "./plugin-api";

class MediaObject implements MediaObjectRemote {
    __proxy_props: any;

    constructor(public mimeType: string, public data: any, options: MediaObjectOptions) {
        this.__proxy_props = {}
        options ||= {};
        options.mimeType = mimeType;
        for (const [key, value] of Object.entries(options)) {
            if (RpcPeer.isTransportSafe(value))
                this.__proxy_props[key] = value;
            (this as any)[key] = value;
        }
    }

    async getData(): Promise<Buffer | string> {
        return Promise.resolve(this.data);
    }
}

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
});

type IdBufferConverter = BufferConverter & {
    id: string;
    name: string;
};

function getBuiltinId(n: number) {
    return 'builtin-' + n;
}

function getExtraId(n: number) {
    return 'extra-' + n;
}

export abstract class MediaManagerBase implements MediaManager {
    builtinConverters: IdBufferConverter[] = [];
    extraConverters: IdBufferConverter[] = [];

    constructor() {
        for (const h of ['http', 'https']) {
            this.builtinConverters.push({
                id: getBuiltinId(this.builtinConverters.length),
                name: 'HTTP Converter',
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
            id: getBuiltinId(this.builtinConverters.length),
            name: 'File Converter',
            fromMimeType: ScryptedMimeTypes.SchemePrefix + 'file',
            toMimeType: ScryptedMimeTypes.MediaObject,
            convert: async (data, fromMimeType, toMimeType) => {
                const url = data.toString();
                const filename = url.substring('file:'.length);

                if (toMimeType === ScryptedMimeTypes.FFmpegInput) {
                    const ffmpegInput: FFmpegInput = {
                        url,
                        inputArguments: [
                            '-i', filename,
                        ]
                    };
                    return this.createFFmpegMediaObject(ffmpegInput);
                }

                const ab = await fs.promises.readFile(filename);
                const mt = mimeType.getType(data.toString());
                const mo = this.createMediaObject(ab, mt);
                return mo;
            }
        });

        this.builtinConverters.push({
            id: getBuiltinId(this.builtinConverters.length),
            name: 'Url to FFmpegInput Converter',
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
            id: getBuiltinId(this.builtinConverters.length),
            name: 'FFmpegInput to MediaStreamUrl Converter',
            fromMimeType: ScryptedMimeTypes.FFmpegInput,
            toMimeType: ScryptedMimeTypes.MediaStreamUrl,
            async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
                return data;
            }
        });

        this.builtinConverters.push({
            id: getBuiltinId(this.builtinConverters.length),
            name: 'MediaStreamUrl to FFmpegInput Converter',
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

        // todo: move this to snapshot plugin
        this.builtinConverters.push({
            id: getBuiltinId(this.builtinConverters.length),
            name: 'Image Converter',
            fromMimeType: 'image/*',
            toMimeType: 'image/*',
            convert: async (data, fromMimeType: string): Promise<Buffer> => {
                return data as Buffer;
            }
        });
    }

    async addConverter(converter: IdBufferConverter): Promise<void> {
        converter.id = getExtraId(this.extraConverters.length);
        this.extraConverters.push(converter);
    }

    async clearConverters(): Promise<void> {
        this.extraConverters = [];
    }

    async convertMediaObjectToJSON<T>(mediaObject: MediaObjectInterface, toMimeType: string): Promise<T> {
        const buffer = await this.convertMediaObjectToBuffer(mediaObject, toMimeType);
        return JSON.parse(buffer.toString());
    }

    abstract getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } };
    abstract getDeviceById<T>(id: string): T & ScryptedDevice;
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

    getConverters(): IdBufferConverter[] {
        const converters = Object.entries(this.getSystemState())
            .filter(([id, state]) => state[ScryptedInterfaceProperty.interfaces]?.value?.includes(ScryptedInterface.BufferConverter))
            .map(([id]) => {
                const device = this.getDeviceById<BufferConverter>(id);
                return {
                    id,
                    name: device.name,
                    fromMimeType: device.fromMimeType,
                    toMimeType: device.toMimeType,
                    convert(data, fromMimeType, toMimeType, options?) {
                        return device.convert(data, fromMimeType, toMimeType, options);
                    },
                } as IdBufferConverter;
            });

        // builtins should be after system converters. these should not be overriden by system,
        // as it could cause system instability with misconfiguration.
        converters.push(...this.builtinConverters);

        // extra converters are added last and do allow overriding builtins, as
        // the instability would be confined to a single plugin.
        converters.push(...this.extraConverters);
        return converters;
    }

    ensureMediaObjectRemote(mediaObject: string | MediaObjectInterface): MediaObjectRemote {
        if (typeof mediaObject === 'string') {
            const mime = mimeType.getType(mediaObject);
            return this.createMediaObjectRemote(mediaObject, mime);
        }
        return mediaObject as MediaObjectRemote;
    }

    async convertMediaObject<T>(mediaObject: MediaObjectInterface, toMimeType: string): Promise<T> {
        const converted = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return converted.data;
    }

    async convertMediaObjectToInsecureLocalUrl(mediaObject: string | MediaObjectInterface, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.InsecureLocalUrl);
        return url.data.toString();
    }

    async convertMediaObjectToBuffer(mediaObject: MediaObjectInterface, toMimeType: string): Promise<Buffer> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        return intermediate.data as Buffer;
    }
    async convertMediaObjectToLocalUrl(mediaObject: string | MediaObjectInterface, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.LocalUrl);
        return url.data.toString();
    }
    async convertMediaObjectToUrl(mediaObject: string | MediaObjectInterface, toMimeType: string): Promise<string> {
        const intermediate = await this.convert(this.getConverters(), this.ensureMediaObjectRemote(mediaObject), toMimeType);
        const converted = this.createMediaObjectRemote(intermediate.data, intermediate.mimeType);
        const url = await this.convert(this.getConverters(), converted, ScryptedMimeTypes.Url);
        return url.data.toString();
    }

    createMediaObjectRemote<T extends MediaObjectOptions>(data: any | Buffer | Promise<string | Buffer>, mimeType: string, options?: T): MediaObjectRemote & T {
        if (typeof data === 'string')
            throw new Error('string is not a valid type. if you intended to send a url, use createMediaObjectFromUrl.');
        if (!mimeType)
            throw new Error('no mimeType provided');
        if (mimeType === ScryptedMimeTypes.MediaObject)
            return data;

        if (data.constructor?.name === Object.name)
            data = Buffer.from(JSON.stringify(data));

        const sourceId = typeof options?.sourceId === 'string' ? options?.sourceId : this.getPluginDeviceId();
        if (sourceId) {
            options ||= {} as T;
            options.sourceId = sourceId;
        }

        return new MediaObject(mimeType, data, options) as MediaObject & T;
    }

    async createFFmpegMediaObject(ffMpegInput: FFmpegInput, options?: MediaObjectOptions): Promise<MediaObjectInterface> {
        return this.createMediaObjectRemote(Buffer.from(JSON.stringify(ffMpegInput)), ScryptedMimeTypes.FFmpegInput, options);
    }

    async createMediaObjectFromUrl(data: string, options?: MediaObjectOptions): Promise<MediaObjectInterface> {
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

    async createMediaObject<T extends MediaObjectOptions>(data: any, mimeType: string, options?: T): Promise<MediaObjectInterface & T> {
        return this.createMediaObjectRemote(data, mimeType, options);
    }

    async convert(converters: IdBufferConverter[], mediaObject: MediaObjectRemote, toMimeType: string): Promise<{ data: Buffer | string | any, mimeType: string }> {
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

        const converterMap = new Map<string, IdBufferConverter>();
        for (const c of converters) {
            converterMap.set(c.id, c);
        }

        const nodes: { [node: string]: { [edge: string]: number } } = {};
        const mediaNode: any = {};
        nodes['mediaObject'] = mediaNode;
        nodes['output'] = {};
        for (const converter of converters) {
            try {
                const inputMime = new MimeType(converter.fromMimeType);
                const convertedMime = new MimeType(converter.toMimeType);
                // catch all converters should be heavily weighted so as not to use them.
                const inputWeight = parseFloat(inputMime.parameters.get('converter-weight')) || (inputMime.essence === '*/*' ? 1000 : 1);
                // const convertedWeight = parseFloat(convertedMime.parameters.get('converter-weight')) || (convertedMime.essence === ScryptedMimeTypes.MediaObject ? 1000 : 1);
                // const conversionWeight = inputWeight + convertedWeight;
                const targetId = converter.id;
                const node: { [edge: string]: number } = nodes[targetId] = {};

                // edge matches
                for (const candidate of converters) {
                    try {
                        const candidateMime = new MimeType(candidate.fromMimeType);
                        if (!mimeMatches(convertedMime, candidateMime))
                            continue;
                        const outputWeight = parseFloat(candidateMime.parameters.get('converter-weight')) || (candidateMime.essence === '*/*' ? 1000 : 1);
                        const candidateId = candidate.id;
                        node[candidateId] = inputWeight + outputWeight;
                    }
                    catch (e) {
                        console.warn(converter.name, 'skipping converter due to error', e)
                    }
                }

                // source matches
                if (mimeMatches(mediaMime, inputMime)) {
                    mediaNode[targetId] = inputWeight;
                }

                // target output matches
                if (mimeMatches(outputMime, convertedMime) || converter.toMimeType === ScryptedMimeTypes.MediaObject) {
                    node['output'] = inputWeight;
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
            throw new Error(`no converter found: ${mediaObject?.mimeType} to ${toMimeType}`);
        // pop off the mediaObject start node, no conversion necessary.
        route.shift();
        // also remove the output node.
        route.splice(route.length - 1);
        let value = await mediaObject.getData();
        let valueMime = new MimeType(mediaObject.mimeType);

        while (route.length) {
            const node = route.shift();
            const converter = converterMap.get(node);
            const converterToMimeType = new MimeType(converter.toMimeType);
            const converterFromMimeType = new MimeType(converter.fromMimeType);
            const type = converterToMimeType.type === '*' ? valueMime.type : converterToMimeType.type;
            const subtype = converterToMimeType.subtype === '*' ? valueMime.subtype : converterToMimeType.subtype;
            let targetMimeType = `${type}/${subtype}`;
            if (!route.length && outputMime.parameters.size) {
                const withParameters = new MimeType(targetMimeType);
                for (const k of outputMime.parameters.keys()) {
                    withParameters.parameters.set(k, outputMime.parameters.get(k));
                }
                targetMimeType = outputMime.toString();
            }

            if (converter.toMimeType === ScryptedMimeTypes.MediaObject) {
                const mo = await converter.convert(value, valueMime.essence, toMimeType, { sourceId }) as MediaObjectInterface;
                const found = await this.convertMediaObject(mo, toMimeType);
                return {
                    data: found,
                    mimeType: toMimeType,
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
