import { readLength } from '@scrypted/common/src/read-stream';
import net from 'net';
import {
    EncryptionMode,
    deriveAesKey,
    encryptXml,
    decryptXml,
    md5Truncated,
} from './crypto';
import {
    BcHeader,
    HeaderClass,
    MsgId,
    buildBody,
    headerLenForClass,
    packHeader,
    parseHeader,
    serializeTalkAdpcmBlock,
    splitBody,
} from './protocol';
import { AdpcmEncoder } from './adpcm';
import {
    TalkAbility,
    TalkAudioConfig,
    buildExtensionXml,
    buildLoginXml,
    buildTalkConfigXml,
    parseNonce,
    parseTalkAbility,
} from './xml';

export interface BaichuanClientOptions {
    host: string;
    port: number;
    username: string;
    password: string;
    channelId?: number;
    console?: Console;
    /** Milliseconds to wait for the TCP connection and for each reply. */
    timeout?: number;
}

export class BaichuanStatusError extends Error {
    constructor(public readonly code: number, public readonly msgId: number) {
        super(`baichuan: request msgId=${msgId} failed with status ${code}`);
    }
}

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * A minimal Baichuan protocol client covering what two-way audio (Talk)
 * needs: login, TalkAbility, TalkConfig/Talk/TalkReset. Not a general
 * purpose Baichuan client (no video, no PTZ, etc. - see the plugin's
 * BaichuanIntercom for how this is used, and the phase 1 plan for why
 * those are out of scope here).
 *
 * One client is meant to cover one short-lived session (e.g. one intercom
 * call): call `login()` once, use it, then `close()`. Reusing a client
 * across multiple Talk sessions was tried live and left the device's audio
 * pipeline in a state where TalkConfig still returned success but no audio
 * actually played - a fresh connection per session avoids that reliably
 * and matches how the official app behaves.
 */
export class BaichuanClient {
    // Assigned in connect(), which must be awaited before any other method is used.
    private socket!: net.Socket;
    private encryptionMode = EncryptionMode.BC;
    private aesKey: Buffer | undefined;
    private msgNum = 0;
    private readonly channelId: number;
    private readonly console: Console | undefined;
    private readonly timeout: number;

    constructor(private readonly options: BaichuanClientOptions) {
        this.channelId = options.channelId ?? 0;
        this.console = options.console;
        this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    }

    private nextMsgNum(): number {
        this.msgNum++;
        return this.msgNum;
    }

    async connect(): Promise<void> {
        this.socket = new net.Socket();
        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
                this.socket.removeListener('connect', onConnect);
                reject(err);
            };
            const onConnect = () => {
                this.socket.removeListener('error', onError);
                resolve();
            };
            this.socket.once('error', onError);
            this.socket.once('connect', onConnect);
            this.socket.setTimeout(this.timeout);
            this.socket.connect(this.options.port, this.options.host);
        });
    }

    /**
     * Performs the full login handshake: an unauthenticated legacy probe to
     * obtain the session nonce and the device's negotiated encryption
     * level, followed by the modern LoginUser/LoginNet exchange.
     *
     * The very first probe message (and only that message) uses the
     * 20-byte legacy header layout; every subsequent message, including
     * the modern login itself, uses the 24-byte layout. Both login
     * messages are always encrypted with the classic BC XOR cipher
     * regardless of the negotiated AES level - observed live and confirmed
     * against the go2rtc reference (login always caps at BC, matching
     * "the encryption protocol cannot go higher than BCEncrypt" for msg id
     * 1). AES only applies to every message after login completes.
     */
    async login(): Promise<void> {
        // Request the highest encryption level (0x12 = full AES); the device
        // tells us in its reply what it actually negotiated.
        const probeHeader: BcHeader = {
            msgId: MsgId.Login,
            bodyLen: 0,
            channelId: this.channelId,
            streamType: 0,
            msgNum: 0,
            responseCode: 0xdc12,
            msgClass: HeaderClass.Legacy,
        };
        this.socket.write(packHeader(probeHeader));

        const probeReply = await this.readRawMessage();
        const nonce = parseNonce(this.decodeXml(probeReply.header, probeReply.body, EncryptionMode.BC));
        const encryptionLevel = probeReply.header.responseCode & 0xff;
        this.encryptionMode = encryptionLevel === 0 ? EncryptionMode.None : encryptionLevel === 1 ? EncryptionMode.BC : EncryptionMode.AES;
        this.aesKey = deriveAesKey(nonce, this.options.password);

        const loginXml = buildLoginXml(
            md5Truncated(`${this.options.username}${nonce}`),
            md5Truncated(`${this.options.password}${nonce}`),
        );
        const loginBody = encryptXml(EncryptionMode.BC, undefined, this.channelId, Buffer.from(loginXml, 'utf8'));
        const loginHeader: BcHeader = {
            msgId: MsgId.Login,
            bodyLen: loginBody.length,
            channelId: this.channelId,
            streamType: 0,
            msgNum: 0,
            responseCode: 0,
            msgClass: HeaderClass.ModernWithOffset,
            binOffset: 0,
        };
        this.socket.write(Buffer.concat([packHeader(loginHeader), loginBody]));

        const loginReply = await this.waitForReply(0);
        if (loginReply.header.responseCode !== 200)
            throw new BaichuanStatusError(loginReply.header.responseCode, MsgId.Login);
    }

    close(): void {
        this.socket?.destroy();
    }

    private async readHeader(): Promise<BcHeader> {
        const hdr20 = await readLength(this.socket, 20);
        const msgClass = hdr20.readUInt16LE(18);
        const hdr = headerLenForClass(msgClass) === 24 ? Buffer.concat([hdr20, await readLength(this.socket, 4)]) : hdr20;
        return parseHeader(hdr);
    }

    private async readRawMessage(): Promise<{ header: BcHeader; body: Buffer }> {
        const header = await this.readHeader();
        const body = header.bodyLen ? await readLength(this.socket, header.bodyLen) : Buffer.alloc(0);
        return { header, body };
    }

    private decodeXml(header: BcHeader, body: Buffer, modeOverride?: EncryptionMode): string {
        const { rest } = splitBody(header, body);
        if (!rest || !rest.length)
            return '';
        const mode = modeOverride ?? (header.msgId === MsgId.Login ? EncryptionMode.BC : this.encryptionMode);
        return decryptXml(mode, this.aesKey, header.channelId, rest).toString('utf8');
    }

    /**
     * Reads messages off the socket until one with `msgNum` arrives. The
     * device sends unsolicited status broadcasts (msgNum 0) interleaved
     * with replies - e.g. we observed VideoInput/Serial/AbilityInfo pushes
     * arrive right after login, unprompted - which must be skipped rather
     * than mistaken for the reply we're waiting for.
     */
    private async waitForReply(msgNum: number, maxSkip = 20): Promise<{ header: BcHeader; xml: string }> {
        for (let i = 0; i < maxSkip; i++) {
            const { header, body } = await this.readRawMessage();
            if (header.msgNum !== msgNum) {
                this.console?.debug?.(`baichuan: skipping unsolicited message msgId=${header.msgId} msgNum=${header.msgNum}`);
                continue;
            }
            return { header, xml: this.decodeXml(header, body) };
        }
        throw new Error(`baichuan: no reply for msgNum=${msgNum} after ${maxSkip} messages`);
    }

    /**
     * Sends a request and waits for its matching reply. Throws
     * `BaichuanStatusError` if the device's response code is not 200 -
     * callers that need to handle a specific non-200 code (e.g. TalkConfig's
     * 422 "already talking") should catch that error and check `.code`.
     */
    async request(msgId: number, opts: { extensionXml?: string; bodyXml?: string; binary?: Buffer } = {}): Promise<{ header: BcHeader; xml: string }> {
        const msgNum = this.nextMsgNum();
        const mode = this.encryptionMode;

        const extension = opts.extensionXml
            ? encryptXml(mode, this.aesKey, this.channelId, Buffer.from(opts.extensionXml, 'utf8'))
            : undefined;
        const payload = opts.bodyXml
            ? encryptXml(mode, this.aesKey, this.channelId, Buffer.from(opts.bodyXml, 'utf8'))
            : undefined;
        const { body, binOffset } = buildBody({ extension, payload, binary: opts.binary });

        const header: BcHeader = {
            msgId,
            bodyLen: body.length,
            channelId: this.channelId,
            streamType: 0,
            msgNum,
            responseCode: 0,
            msgClass: HeaderClass.ModernWithOffset,
            binOffset: binOffset ?? 0,
        };
        this.socket.write(Buffer.concat([packHeader(header), body]));

        const reply = await this.waitForReply(msgNum);
        if (reply.header.responseCode !== 200)
            throw new BaichuanStatusError(reply.header.responseCode, msgId);
        return reply;
    }

    async getTalkAbility(): Promise<TalkAbility> {
        const reply = await this.request(MsgId.TalkAbility, {
            extensionXml: buildExtensionXml({ channelId: this.channelId }),
        });
        return parseTalkAbility(reply.xml);
    }

    /**
     * Sends TalkReset (also doubles as "stop talking"). A 422 here just
     * means nothing was talking - not an error worth surfacing.
     */
    async stopTalk(): Promise<void> {
        try {
            await this.request(MsgId.TalkReset, {
                extensionXml: buildExtensionXml({ channelId: this.channelId }),
            });
        }
        catch (e) {
            if (e instanceof BaichuanStatusError && e.code === 422)
                return;
            throw e;
        }
    }

    /**
     * Negotiates and opens a Talk session using the first ADPCM profile the
     * device actually advertises (never hardcode duplex/audioStreamMode -
     * different Reolink models advertise different supported values; this
     * doorbell advertises `duplexList: [FDX]` and
     * `audioStreamModeList: [followVideoStream, mixAudioStream]`, prefering
     * "fullDuplex"/"speaker" when a device happens to advertise those,
     * matching the go2rtc reference client's selection logic).
     */
    async startTalk(): Promise<TalkSession> {
        const ability = await this.getTalkAbility();
        const audioConfig = ability.audioConfigOptions.find(c => c.audioType === 'adpcm');
        if (!audioConfig)
            throw new Error('baichuan: device does not advertise an ADPCM talk profile');
        if (!ability.duplexOptions.length || !ability.audioStreamModeOptions.length)
            throw new Error('baichuan: device returned no talk duplex/audioStreamMode options');

        const duplex = ability.duplexOptions.includes('fullDuplex') ? 'fullDuplex' : ability.duplexOptions[0];
        const audioStreamMode = ability.audioStreamModeOptions.includes('speaker')
            ? 'speaker'
            : ability.audioStreamModeOptions[0];

        const talkConfigXml = buildTalkConfigXml(this.channelId, duplex, audioStreamMode, audioConfig);
        const extensionXml = buildExtensionXml({ channelId: this.channelId });

        try {
            await this.request(MsgId.TalkConfig, { extensionXml, bodyXml: talkConfigXml });
        }
        catch (e) {
            // Another session left talk open; per the observed device
            // behavior (and go2rtc's client), reset then retry once.
            if (e instanceof BaichuanStatusError && e.code === 422) {
                await this.stopTalk();
                await this.request(MsgId.TalkConfig, { extensionXml, bodyXml: talkConfigXml });
            }
            else {
                throw e;
            }
        }

        return new TalkSession(this, audioConfig);
    }

    /** @internal used by TalkSession */
    async writeAdpcmBlock(block: Buffer, seq: number): Promise<void> {
        const payload = serializeTalkAdpcmBlock(block, seq);
        // The device does ack each Talk block individually (confirmed
        // live), but we deliberately do not wait for it here: blocking on
        // a round trip per 64ms audio block is exactly the kind of added
        // latency this client exists to avoid. Any stray acks are simply
        // skipped as unsolicited messages by the next waitForReply() call
        // (e.g. stopTalk's), which is harmless.
        const msgNum = this.nextMsgNum();
        const extension = encryptXml(
            this.encryptionMode, this.aesKey, this.channelId,
            Buffer.from(buildExtensionXml({ channelId: this.channelId, binaryData: true }), 'utf8'),
        );
        const { body, binOffset } = buildBody({ extension, binary: payload });
        const header: BcHeader = {
            msgId: MsgId.Talk,
            bodyLen: body.length,
            channelId: this.channelId,
            streamType: 0,
            msgNum,
            responseCode: 0,
            msgClass: HeaderClass.ModernWithOffset,
            binOffset: binOffset ?? 0,
        };
        this.socket.write(Buffer.concat([packHeader(header), body]));
    }
}

/**
 * An open Talk (two-way audio) session. Encodes and sends PCM audio as
 * ADPCM blocks matching the device's negotiated frame size; the caller is
 * responsible for producing PCM at `sampleRate` and feeding it in chunks of
 * exactly `samplesPerBlock` samples (see BaichuanIntercom for the ffmpeg
 * pipeline that does this).
 */
export class TalkSession {
    private readonly encoder = new AdpcmEncoder();
    private seq = 0;
    closed = false;

    constructor(private readonly client: BaichuanClient, public readonly audioConfig: TalkAudioConfig) {
    }

    get sampleRate(): number {
        return this.audioConfig.sampleRate;
    }

    get samplesPerBlock(): number {
        return this.audioConfig.lengthPerEncoder;
    }

    /** Size, in bytes, of one PCM chunk the caller must read before calling `writeSamples`. */
    get pcmBytesPerBlock(): number {
        return this.samplesPerBlock * 2; // 16-bit samples
    }

    async writeSamples(pcm: Int16Array): Promise<void> {
        if (this.closed)
            throw new Error('baichuan: talk session is closed');
        if (pcm.length !== this.samplesPerBlock)
            throw new Error(`baichuan: expected ${this.samplesPerBlock} samples, got ${pcm.length}`);
        const block = this.encoder.encodeBlock(pcm);
        this.seq++;
        await this.client.writeAdpcmBlock(block, this.seq);
    }

    async close(): Promise<void> {
        if (this.closed)
            return;
        this.closed = true;
        await this.client.stopTalk();
    }
}
