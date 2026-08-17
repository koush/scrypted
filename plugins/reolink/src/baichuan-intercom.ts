import { readLength, StreamEndError } from '@scrypted/common/src/read-stream';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import sdk, { FFmpegInput, Intercom, MediaObject, ScryptedMimeTypes } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { RtspSmartCamera } from '../../rtsp/src/rtsp';
import { BaichuanClient, TalkSession } from './baichuan/client';

const { mediaManager } = sdk;

const DEFAULT_BAICHUAN_PORT = 9000;

/**
 * Two-way audio over Reolink's proprietary Baichuan protocol, as a
 * lower-latency alternative to the ONVIF backchannel (`OnvifIntercom`).
 * Baichuan carries raw ADPCM audio blocks directly, with no RTP layer or
 * jitter buffer, which is where most of the latency difference measured
 * against a real device came from.
 *
 * One `BaichuanClient`/talk session is opened per `startIntercom()` call
 * and fully torn down on `stopIntercom()` - see BaichuanClient's own doc
 * comment for why sessions are not reused.
 */
export class BaichuanIntercom implements Intercom {
    private process: ChildProcess;
    private client: BaichuanClient;
    private session: TalkSession;

    constructor(public camera: RtspSmartCamera) {
    }

    async startIntercom(media: MediaObject): Promise<void> {
        await this.stopIntercom();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const port = parseInt(this.camera.storage.getItem('baichuanPort')) || DEFAULT_BAICHUAN_PORT;
        const client = new BaichuanClient({
            host: this.camera.getIPAddress(),
            port,
            username: this.camera.getUsername(),
            password: this.camera.getPassword(),
            console: this.camera.console,
        });

        await client.connect();
        await client.login();
        const session = await client.startTalk();
        this.client = client;
        this.session = session;
        this.camera.console.log(`baichuan intercom: talk session open (${session.sampleRate}Hz, ${session.samplesPerBlock} samples/block)`);

        const ffmpegArgs = ffmpegInput.inputArguments.slice();
        ffmpegArgs.push(
            // Audio only - no video/data/subtitle streams to deal with.
            '-vn', '-dn', '-sn',
            // Raw signed 16-bit PCM, matching what AdpcmEncoder expects.
            '-acodec', 'pcm_s16le',
            // Bypass ffmpeg's own internal buffering; we want each block
            // written to the pipe as soon as it's encoded.
            '-avioflags', 'direct',
            '-fflags', '+flush_packets+nobuffer',
            '-flush_packets', '1',
            '-flags', '+global_header+low_delay',
            '-ac', '1',
            '-ar', session.sampleRate.toString(),
            '-f', 's16le',
            '-muxdelay', '0',
            'pipe:3',
        );

        safePrintFFmpegArguments(this.camera.console, ffmpegArgs);
        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.process = cp;
        ffmpegLogInitialOutput(this.camera.console, cp);
        cp.on('exit', () => this.camera.console.log('baichuan intercom: ffmpeg exited'));

        const socket = cp.stdio[3] as Readable;
        const pcmBytesPerBlock = session.pcmBytesPerBlock;

        (async () => {
            try {
                while (true) {
                    const data = await readLength(socket, pcmBytesPerBlock);
                    if (!data.length)
                        break;
                    // Read as int16 samples rather than viewing the Buffer's
                    // underlying ArrayBuffer directly: Node may hand back a
                    // Buffer backed by a shared, oddly-offset pool, which an
                    // Int16Array view would misinterpret or throw on.
                    const samples = new Int16Array(pcmBytesPerBlock / 2);
                    for (let i = 0; i < samples.length; i++)
                        samples[i] = data.readInt16LE(i * 2);
                    await session.writeSamples(samples);
                }
            }
            catch (e) {
                if (!(e instanceof StreamEndError))
                    this.camera.console.error('baichuan intercom: audio pipeline error', e);
            }
            finally {
                await this.stopIntercom();
            }
        })();
    }

    async stopIntercom(): Promise<void> {
        if (this.process) {
            safeKillFFmpeg(this.process);
            this.process = undefined;
        }

        const session = this.session;
        const client = this.client;
        this.session = undefined;
        this.client = undefined;

        try {
            await session?.close();
        }
        catch (e) {
            this.camera.console.error('baichuan intercom: error closing talk session', e);
        }
        finally {
            client?.close();
        }
    }
}
