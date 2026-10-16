import { createCipheriv, createDecipheriv, createHash } from 'crypto';
import { Socket } from 'net';
import { parseStringPromise } from 'xml2js';

// Baichuan TCP wire format references:
// https://github.com/starkillerOG/reolink_aio/tree/main/reolink_aio/baichuan
// https://github.com/thirtythreeforty/neolink/blob/master/crates/core/src/bc_protocol/talk.rs
// Protocol implementation here is independent of those projects.
const magic = 0x0abcdef0;
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" ?>\n';
const xmlKey = [0x1f, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78, 0xff];
const aesIv = Buffer.from('0123456789abcdef');
const timeout = 5000;
const maxPacketLength = 1024 * 1024;

type Encryption = 'bc' | 'aes';

export interface TalkAbility {
    duplex: string;
    audioStreamMode: string;
    audioType: string;
    sampleRate: number;
    samplePrecision: number;
    lengthPerEncoder: number;
    soundTrack: string;
    priority?: number;
}

interface PendingRequest {
    command: number;
    encryption: Encryption;
    resolve: (xml: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

class BaichuanResponseError extends Error {
    constructor(public command: number, public statusCode: number) {
        super(`Reolink Baichuan command ${command} returned ${statusCode}`);
    }
}

function md5(value: string) {
    return createHash('md5').update(value).digest('hex').toUpperCase().slice(0, 31);
}

function xor(data: Buffer, offset: number) {
    return Buffer.from(data.map((value, index) => value ^ xmlKey[(index + offset) % 8] ^ offset));
}

function findValues(object: any, tag: string): any[] {
    if (!object || typeof object !== 'object')
        return [];
    const result: any[] = [];
    for (const [key, value] of Object.entries(object)) {
        if (key === tag)
            result.push(...(Array.isArray(value) ? value : [value]));
        else if (Array.isArray(value))
            value.forEach(child => result.push(...findValues(child, tag)));
        else
            result.push(...findValues(value, tag));
    }
    return result;
}

function escapeXml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export class BaichuanTalkClient {
    onClose?: (error: Error) => void;
    private socket?: Socket;
    private buffer: Buffer = Buffer.alloc(0);
    private pending = new Map<number, PendingRequest>();
    private messageId = 0;
    private aesKey?: Buffer;
    private ability?: TalkAbility;
    private encryption: Encryption = 'aes';
    private closed = false;
    private closing = false;
    private talking = false;
    private starting?: Promise<void>;
    private closeTask?: Promise<void>;

    constructor(private host: string, private port: number, private username: string, private password: string, private channel: number) {
        if (!host?.trim() || !username)
            throw new Error('Reolink Baichuan host and username are required');
        this.password = password || '';
        if (!Number.isInteger(channel) || channel < 0 || channel > 99)
            throw new Error('Invalid Reolink Baichuan channel');
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error('Invalid Reolink Baichuan port');
    }

    async connect(): Promise<TalkAbility> {
        if (this.closed || this.socket)
            throw new Error('Reolink Baichuan client is already connected or closed');
        const socket = this.socket = new Socket();
        socket.setNoDelay(true);
        socket.on('data', data => {
            try {
                this.receive(data);
            }
            catch (error) {
                this.fail(error as Error);
            }
        });
        socket.on('error', error => this.fail(error));
        socket.on('close', () => this.fail(new Error('Reolink Baichuan connection closed')));
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error('Reolink Baichuan connection timed out')), timeout);
                const finish = (error?: Error) => {
                    clearTimeout(timer);
                    socket.removeListener('connect', connected);
                    socket.removeListener('error', errored);
                    socket.removeListener('close', ended);
                    error ? reject(error) : resolve();
                };
                const connected = () => finish();
                const errored = (error: Error) => finish(error);
                const ended = () => finish(new Error('Reolink Baichuan connection closed'));
                socket.once('connect', connected);
                socket.once('error', errored);
                socket.once('close', ended);
                socket.connect(this.port, this.host);
            });
            const challenge = await this.request(1, '', 'bc', false, undefined, true);
            const challengeXml = await parseStringPromise(challenge, { explicitArray: false, trim: true });
            const nonce = findValues(challengeXml, 'nonce')[0];
            if (typeof nonce !== 'string' || !nonce || findValues(challengeXml, 'sigVer')[0] === 'v3')
                throw new Error('Reolink Baichuan local login is unavailable');
            this.aesKey = Buffer.from(md5(`${nonce}-${this.password}`).slice(0, 16));
            const login = `${xmlHeader}<body><LoginUser version="1.1"><userName>${md5(this.username + nonce)}</userName><password>${md5(this.password + nonce)}</password><userVer>1</userVer></LoginUser><LoginNet version="1.1"><type>LAN</type><udpPort>0</udpPort></LoginNet></body>`;
            await this.request(1, login, 'bc', false);
            this.ability = await this.parseAbility(await this.request(10));
            return this.ability;
        }
        catch (error) {
            this.fail(error as Error);
            throw error;
        }
    }

    private async parseAbility(xml: string): Promise<TalkAbility> {
        const document = await parseStringPromise(xml, { explicitArray: false, trim: true });
        const ability = findValues(document, 'TalkAbility')[0];
        const configs = findValues(ability, 'audioConfig');
        const config = configs.find(config => config.audioType === 'adpcm'
            && config.soundTrack === 'mono'
            && String(config.samplePrecision) === '16');
        if (!config)
            throw new Error('Reolink Baichuan does not advertise 16-bit mono ADPCM talk audio');
        const sampleRate = Number(config.sampleRate);
        const lengthPerEncoder = Number(config.lengthPerEncoder);
        if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000
            || !Number.isInteger(lengthPerEncoder) || lengthPerEncoder < 8 || lengthPerEncoder > 16384 || lengthPerEncoder % 2)
            throw new Error('Reolink Baichuan returned unsupported audio parameters');
        const duplexes = findValues(ability, 'duplex');
        const modes = findValues(ability, 'audioStreamMode');
        const result: TalkAbility = {
            duplex: duplexes.includes('FDX') ? 'FDX' : duplexes[0],
            audioStreamMode: modes.includes('mixAudioStream') ? 'mixAudioStream' : modes[0],
            audioType: 'adpcm', sampleRate, samplePrecision: 16, lengthPerEncoder, soundTrack: 'mono',
        };
        if (typeof result.duplex !== 'string' || !result.duplex || typeof result.audioStreamMode !== 'string' || !result.audioStreamMode)
            throw new Error('Reolink Baichuan returned incomplete talk capabilities');
        const priority = Number(config.priority);
        if (config.priority !== undefined && Number.isSafeInteger(priority) && priority >= 0)
            result.priority = priority;
        return result;
    }

    async startTalk(): Promise<void> {
        const ability = this.ability;
        if (!ability || this.talking || this.starting || this.closed || this.closing)
            throw new Error('Reolink Baichuan talk session is not ready');
        this.starting = this.configureTalk(ability);
        try {
            await this.starting;
        }
        finally {
            this.starting = undefined;
        }
    }

    private async configureTalk(ability: TalkAbility): Promise<void> {
        const config = `${xmlHeader}<body><TalkConfig version="1.1"><channelId>${this.channel}</channelId><duplex>${escapeXml(ability.duplex)}</duplex><audioStreamMode>${escapeXml(ability.audioStreamMode)}</audioStreamMode><audioConfig>${ability.priority === undefined ? '' : `<priority>${ability.priority}</priority>`}<audioType>adpcm</audioType><sampleRate>${ability.sampleRate}</sampleRate><samplePrecision>16</samplePrecision><lengthPerEncoder>${ability.lengthPerEncoder}</lengthPerEncoder><soundTrack>mono</soundTrack></audioConfig></TalkConfig></body>`;
        for (const encryption of ['aes', 'bc'] as Encryption[]) {
            try {
                await this.request(201, config, encryption);
                if (this.closed)
                    throw new Error('Reolink Baichuan connection is closed');
                this.encryption = encryption;
                this.talking = true;
                return;
            }
            catch (error) {
                if (!(error instanceof BaichuanResponseError) || error.statusCode !== 400 || encryption === 'bc')
                    throw error;
            }
        }
    }

    async sendAudio(payload: Buffer): Promise<void> {
        if (!this.talking || this.closed || this.closing)
            throw new Error('Reolink Baichuan talk session is not active');
        await this.request(202, '', this.encryption, true, payload);
    }

    private crypt(data: Buffer, encryption: Encryption, offset: number, decrypt = false) {
        if (encryption === 'bc')
            return xor(data, offset);
        if (!this.aesKey)
            throw new Error('Reolink Baichuan AES key is unavailable');
        const cipher = decrypt ? createDecipheriv('aes-128-cfb', this.aesKey, aesIv) : createCipheriv('aes-128-cfb', this.aesKey, aesIv);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }

    private async request(command: number, body = '', encryption: Encryption = 'aes', channel = true, payload?: Buffer, challenge = false): Promise<string> {
        const socket = this.socket;
        if (this.closed || !socket || socket.destroyed)
            throw new Error('Reolink Baichuan connection is closed');
        if (this.pending.size >= 4 || socket.writableLength > maxPacketLength)
            throw new Error('Reolink Baichuan write queue is full');
        const offset = channel ? this.channel + 1 : 250;
        this.messageId = (this.messageId + 1) % 0x1000000;
        const id = (this.messageId * 256 + offset) >>> 0;
        const extension = channel ? `${xmlHeader}<Extension version="1.1">${payload ? '<binaryData>1</binaryData>' : ''}<channelId>${this.channel}</channelId></Extension>` : '';
        const encryptedExtension = this.crypt(Buffer.from(extension), encryption, offset);
        const encryptedBody = this.crypt(Buffer.from(body), encryption, offset);
        const length = encryptedExtension.length + encryptedBody.length + (payload?.length || 0);
        if (length > maxPacketLength)
            throw new Error('Reolink Baichuan packet is too large');
        const header = Buffer.alloc(challenge ? 20 : 24);
        header.writeUInt32LE(magic, 0);
        header.writeUInt32LE(command, 4);
        header.writeUInt32LE(length, 8);
        header.writeUInt32LE(id, 12);
        header.writeUInt16BE(challenge ? 0x12dc : 0, 16);
        header.writeUInt16BE(challenge ? 0x1465 : 0x1464, 18);
        if (!challenge)
            header.writeUInt32LE(encryptedExtension.length, 20);
        const packet = Buffer.concat([header, encryptedExtension, encryptedBody, payload || Buffer.alloc(0)]);
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error(`Reolink Baichuan command ${command} timed out`)), timeout);
            this.pending.set(id, { command, encryption, resolve, reject, timer });
            // A matching reply acknowledges delivery and bounds queued audio even when
            // the socket's local write buffer has already drained.
            socket.write(packet, error => {
                if (error)
                    this.fail(error);
            });
        });
    }

    private receive(data: Buffer) {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
        while (this.buffer.length >= 20) {
            if (this.buffer.readUInt32LE(0) !== magic)
                throw new Error('Invalid Reolink Baichuan packet magic');
            const messageClass = this.buffer.readUInt16BE(18);
            const headerLength = [0x1464, 0].includes(messageClass) ? 24 : 20;
            if (![0, 0x1464, 0x1465, 0x1466].includes(messageClass))
                throw new Error('Unsupported Reolink Baichuan packet class');
            const length = this.buffer.readUInt32LE(8);
            if (length > maxPacketLength)
                throw new Error('Reolink Baichuan reply is too large');
            if (this.buffer.length < headerLength + length)
                return;
            const packet = this.buffer.subarray(0, headerLength + length);
            this.buffer = this.buffer.subarray(headerLength + length);
            const id = packet.readUInt32LE(12);
            const request = this.pending.get(id);
            if (!request)
                continue; // Unsolicited device notifications and late replies.
            if (request.command !== packet.readUInt32LE(4))
                throw new Error('Reolink Baichuan reply command does not match request');
            this.pending.delete(id);
            clearTimeout(request.timer);
            try {
                const status = packet.readUInt16LE(16);
                if (headerLength === 24 && ![200, 201, 300].includes(status))
                    throw new BaichuanResponseError(request.command, status);
                let start = headerLength;
                if (headerLength === 24) {
                    const extensionLength = packet.readUInt32LE(20);
                    if (extensionLength > length)
                        throw new Error('Invalid Reolink Baichuan extension length');
                    // A nonzero offset separates independently encrypted Extension
                    // and body; if all bytes are Extension there is no XML body.
                    start += extensionLength;
                }
                const indicator = packet.readUInt16BE(16);
                const encryption = headerLength === 20 && [0x01dd, 0x12dd].includes(indicator) ? 'bc' : request.encryption;
                const body = packet.subarray(start);
                const xml = headerLength === 20 && indicator === 0x00dd ? body.toString() : this.crypt(body, encryption, packet[12], true).toString();
                request.resolve(xml);
            }
            catch (error) {
                request.reject(error as Error);
            }
        }
    }

    private fail(error: Error) {
        if (this.closed)
            return;
        this.closed = true;
        this.destroy(error);
        if (!this.closing)
            this.onClose?.(error);
    }

    private destroy(error: Error) {
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        this.pending.clear();
        this.socket?.destroy();
        this.buffer = Buffer.alloc(0);
        this.aesKey = undefined;
    }

    close(): Promise<void> {
        return this.closeTask ||= this.closeConnection();
    }

    private async closeConnection(): Promise<void> {
        if (this.closed)
            return;
        this.closing = true;
        // A successful pending TalkConfig can acquire the speaker even if the
        // caller stopped while waiting. Await its bounded acknowledgement so we
        // stop only our own accepted session, never a rejected/busy session.
        try {
            await this.starting;
        }
        catch (e) {
        }
        // Mark talk inactive before awaiting the stop acknowledgement to prevent
        // audio writes from racing with the stop command.
        const talking = this.talking;
        this.talking = false;
        try {
            if (talking)
                await this.request(11, '', this.encryption);
        }
        finally {
            this.closed = true;
            this.destroy(new Error('Reolink Baichuan connection closed'));
        }
    }
}
