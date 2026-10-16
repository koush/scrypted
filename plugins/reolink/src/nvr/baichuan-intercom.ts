/*
 * ADPCM framing and encoder reference: ha-reolink-talk (MIT License).
 * Copyright (c) 2026 joeblack2k (original project)
 * Copyright (c) 2026 Mathias Holm (this fork/extension)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import sdk, { FFmpegInput, Intercom, MediaObject, ScryptedMimeTypes } from '@scrypted/sdk';
import { ChildProcess, spawn } from 'child_process';
import { Readable } from 'stream';
import { BaichuanTalkClient } from './baichuan';

const imaIndex = [-1, -1, -1, -1, 2, 4, 6, 8];
const imaStep = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
    143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
    544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
    2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
    7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350,
    22385, 24623, 27086, 29794, 32767,
];

// Reolink uses little-endian predictor state and low-nibble-first DVI-4 audio.
// Carry the predictor and step index between blocks, as in ha-reolink-talk.
export class BaichuanAdpcmEncoder {
    private predictor: number;
    private index = 0;

    encode(pcm: Buffer) {
        if (this.predictor === undefined) {
            if (pcm.length < 6 || pcm.length % 4 !== 2)
                throw new Error('Invalid initial Baichuan PCM block length');
            this.predictor = pcm.readInt16LE(0);
            pcm = pcm.subarray(2);
        }
        if (pcm.length % 4 || !pcm.length)
            throw new Error('Invalid Baichuan PCM block length');

        const block = Buffer.alloc(pcm.length / 4 + 4);
        block.writeInt16LE(this.predictor, 0);
        block[2] = this.index;
        for (let offset = 0; offset < pcm.length; offset += 2) {
            const step = imaStep[this.index];
            let difference = pcm.readInt16LE(offset) - this.predictor;
            let nibble = difference < 0 ? 8 : 0;
            difference = Math.abs(difference);
            let delta = step >> 3;
            for (const bit of [4, 2, 1]) {
                const magnitude = step >> (bit === 4 ? 0 : bit === 2 ? 1 : 2);
                if (difference >= magnitude) {
                    nibble |= bit;
                    difference -= magnitude;
                    delta += magnitude;
                }
            }
            this.predictor = Math.max(-32768, Math.min(32767,
                this.predictor + (nibble & 8 ? -delta : delta)));
            this.index = Math.max(0, Math.min(88, this.index + imaIndex[nibble & 7]));
            block[4 + (offset >> 2)] |= nibble << (offset % 4 ? 4 : 0);
        }

        // BcMedia ADPCM: duplicated payload length, audio magic and block size,
        // followed by the predictor block padded to an eight-byte boundary.
        const packet = Buffer.alloc(12 + Math.ceil(block.length / 8) * 8);
        packet.writeUInt32LE(0x62773130, 0);
        packet.writeUInt16LE(block.length + 4, 4);
        packet.writeUInt16LE(block.length + 4, 6);
        packet.writeUInt16LE(0x0100, 8);
        packet.writeUInt16LE((block.length - 4) / 2, 10);
        block.copy(packet, 12);
        return packet;
    }
}

interface TalkSession {
    client?: BaichuanTalkClient;
    process?: ChildProcess;
    stopped: boolean;
    cleanup?: Promise<void>;
    previousCleanup?: Promise<void>;
    timer?: NodeJS.Timeout;
    wake?: () => void;
}

export class BaichuanIntercom implements Intercom {
    private session: TalkSession;

    constructor(private console: Console, private getClient: () => BaichuanTalkClient) {
    }

    private close(session: TalkSession) {
        if (session.cleanup)
            return session.cleanup;
        session.stopped = true;
        clearTimeout(session.timer);
        session.wake?.();
        session.cleanup = Promise.allSettled([
            session.previousCleanup,
            session.client?.close(),
            session.process?.pid && session.process.exitCode === null && session.process.signalCode === null
                ? safeKillFFmpeg(session.process) : undefined,
        ]).then(results => {
            if (results.some(result => result.status === 'rejected'))
                this.console.error('Reolink native intercom cleanup failed');
        }).finally(() => {
            if (this.session === session)
                this.session = undefined;
        });
        return session.cleanup;
    }

    async startIntercom(media: MediaObject) {
        const previous = this.session;
        const session: TalkSession = { stopped: false };
        this.session = session;
        try {
            if (previous)
                await (session.previousCleanup = this.close(previous));
            if (session.stopped)
                return;
            const input = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);
            if (session.stopped)
                return;
            const client = session.client = this.getClient();
            client.onClose = () => {
                if (!session.stopped) {
                    this.console.error('Reolink native intercom connection closed');
                    this.close(session).catch(() => { });
                }
            };
            const ability = await client.connect();
            if (session.stopped)
                return;
            // lengthPerEncoder is the number of PCM samples per DVI-4 block.
            // The encoded block is lengthPerEncoder / 2 bytes plus four state bytes.
            const samples = ability.lengthPerEncoder;
            if (!Number.isInteger(samples) || samples < 8 || samples > 32760 || samples % 4
                || !Number.isInteger(ability.sampleRate) || ability.sampleRate < 8000 || ability.sampleRate > 48000)
                throw new Error('Unsupported Reolink native talk audio format');
            const ffmpeg = await sdk.mediaManager.getFFmpegPath();
            if (session.stopped)
                return;
            await client.startTalk();
            if (session.stopped)
                return;
            const cp = session.process = spawn(ffmpeg, [
                '-hide_banner', '-loglevel', 'error',
                ...input.inputArguments,
                '-vn', '-sn', '-dn', '-acodec', 'pcm_s16le',
                '-ac', '1', '-ar', ability.sampleRate.toString(),
                '-f', 's16le', 'pipe:3',
            ], { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
            // FFmpeg errors may include credential-bearing input URLs. Consume stderr
            // without logging it, and report only the process exit status below.
            cp.stderr.resume();
            cp.on('error', () => {
                if (!session.stopped)
                    this.console.error('Reolink native intercom audio process failed');
                this.close(session).catch(() => { });
            });
            cp.on('exit', code => {
                if (!session.stopped && code)
                    this.console.error('Reolink native intercom audio exited:', code);
            });
            await new Promise<void>((resolve, reject) => {
                cp.once('spawn', resolve);
                cp.once('error', reject);
            });
            if (session.stopped)
                return;
            this.console.log('Reolink native intercom started');
            this.forward(session, cp.stdio[3] as Readable, samples, ability.sampleRate)
                .catch(() => {
                    if (!session.stopped)
                        this.console.error('Reolink native intercom audio stream failed');
                })
                .finally(() => this.close(session).catch(() => { }));
        }
        catch (e) {
            await this.close(session);
            throw e;
        }
    }

    private async forward(session: TalkSession, stream: Readable, samples: number, sampleRate: number) {
        const encoder = new BaichuanAdpcmEncoder();
        const pcmBytes = samples * 2;
        let blockBytes = pcmBytes + 2;
        let pending = Buffer.alloc(0);
        let nextSend = performance.now();
        const send = async (pcm: Buffer) => {
            // Pace to a monotonic clock without building an unbounded audio queue.
            // A slow ACK resets the schedule instead of sending catch-up bursts.
            await this.wait(session, nextSend - performance.now());
            if (session.stopped)
                return;
            await session.client.sendAudio(encoder.encode(pcm));
            nextSend = Math.max(nextSend + samples / sampleRate * 1000, performance.now());
        };
        for await (const chunk of stream) {
            if (session.stopped)
                return;
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= blockBytes) {
                if (session.stopped)
                    return;
                await send(pending.subarray(0, blockBytes));
                pending = pending.subarray(blockBytes);
                blockBytes = pcmBytes;
            }
        }
        if (!session.stopped && pending.length >= 2) {
            const tail = Buffer.alloc(blockBytes);
            pending.copy(tail);
            await send(tail);
        }
        // Natural EOF must let the last block play before TalkReset. User stop
        // cancels this delay immediately, along with the FFmpeg process.
        await this.wait(session, nextSend - performance.now());
    }

    private async wait(session: TalkSession, delay: number) {
        if (session.stopped || delay <= 0)
            return;
        await new Promise<void>(resolve => {
            session.wake = resolve;
            session.timer = setTimeout(resolve, delay);
        });
        session.wake = undefined;
    }

    async stopIntercom() {
        const session = this.session;
        if (session)
            await this.close(session);
    }
}
