import { BufferConverter, ScryptedMimeTypes } from '@scrypted/sdk/types';
import Graph from 'node-dijkstra';
import MimeType from 'whatwg-mimetype';
import { MediaObjectRemote } from './plugin/plugin-api';
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

export async function ensureBuffer(data: Buffer | string): Promise<Buffer> {
    if (typeof data === 'string') {
        const ab = await axios.get(data as string, {
            responseType: 'arraybuffer',
            httpsAgent,
        });
        return Buffer.from(ab.data);
    }
    return Buffer.from(data);
}

export async function convert(converters: BufferConverter[], mediaObject: MediaObjectRemote, toMimeType: string): Promise<{ data: Buffer | string, mimeType: string }> {
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
        const inputMime = new MimeType(converter.fromMimeType);
        const convertedMime = new MimeType(converter.toMimeType);
        const targetId = converterIds.get(converter);
        const node: any = nodes[targetId] = {};
        for (const candidate of converters) {
            const candidateMime = new MimeType(candidate.fromMimeType);
            if (!mimeMatches(convertedMime, candidateMime))
                continue;
            const candidateId = converterIds.get(candidate);
            node[candidateId] = 1;
        }

        if (mimeMatches(mediaMime, inputMime)) {
            mediaNode[targetId] = 1;
        }
        if (mimeMatches(convertedMime, outputMime)) {
            node['output'] = 1;
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
        const targetMime = new MimeType(converter.toMimeType);
        const inputMime = new MimeType(converter.fromMimeType);

        if (typeof value === 'string' && !inputMime.parameters.has(ScryptedMimeTypes.AcceptUrlParameter)) {
            value = await ensureBuffer(value);
        }
        value = await converter.convert(value, valueMime.essence);
        const type = targetMime.type === '*' ? valueMime.type : targetMime.type;
        const subtype = targetMime.subtype === '*' ? valueMime.subtype : targetMime.subtype;
        valueMime = new MimeType(`${type}/${subtype}`);
    }

    return {
        data: value,
        mimeType: valueMime.essence,
    };
}