import { createCipheriv, createHmac, hkdfSync } from 'crypto';
import type { RTCSFrameKey } from '@scrypted/sdk';

// HomeKit's AES-256-CTR/HMAC-SHA512 suites: video uses an 80-bit tag,
// audio a 32-bit tag. Keys are derived per RTP stream for the HomeKit profile.
export type SFrameSuite = 6 | 8;
const maxUint64 = (1n << 64n) - 1n;

function uint64(value: bigint): Buffer {
    if (value < 0n || value > maxUint64)
        throw new RangeError('SFrame integer exceeds uint64');
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(value);
    return buffer;
}

export function encodeSFrameHeader(kid: bigint, counter: bigint): Buffer {
    let config = 0;
    const fields: Buffer[] = [];
    for (const [value, shift] of [[kid, 4], [counter, 0]] as const) {
        let bytes = uint64(value);
        if (value <= 7n) {
            config |= Number(value) << shift;
            continue;
        }
        while (bytes.length > 1 && bytes[0] === 0)
            bytes = bytes.subarray(1);
        config |= (8 | (bytes.length - 1)) << shift;
        fields.push(bytes);
    }
    return Buffer.concat([Buffer.from([config]), ...fields]);
}

export function deriveSFrameKeys(baseKey: Buffer, kid: bigint, suite: SFrameSuite) {
    const suiteBytes = Buffer.alloc(2);
    suiteBytes.writeUInt16BE(suite);
    const suffix = Buffer.concat([uint64(kid), suiteBytes]);
    const derive = (label: string, length: number) => Buffer.from(hkdfSync(
        'sha512', baseKey, Buffer.alloc(0), Buffer.concat([Buffer.from(label), suffix]), length,
    ));
    return {
        key: derive('SFrame 1.0 Secret key ', 96),
        salt: derive('SFrame 1.0 Secret salt ', 12),
    };
}

// RFC 9605 CTR/HMAC AEAD. Metadata is authenticated but not carried in the frame.
export function protectSFrame(keys: ReturnType<typeof deriveSFrameKeys>, suite: SFrameSuite,
    kid: bigint, counter: bigint, plaintext: Buffer, metadata = Buffer.alloc(0)): Buffer {
    const header = encodeSFrameHeader(kid, counter);
    const aad = Buffer.concat([header, metadata]);
    const nonce = Buffer.from(keys.salt);
    const counterBytes = uint64(counter);
    for (let i = 0; i < counterBytes.length; i++)
        nonce[nonce.length - counterBytes.length + i] ^= counterBytes[i];
    const cipher = createCipheriv('aes-256-ctr', keys.key.subarray(0, 32), Buffer.concat([nonce, Buffer.alloc(4)]));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tagLength = suite === 6 ? 10 : 4;
    const lengths = Buffer.alloc(24);
    lengths.writeBigUInt64BE(BigInt(aad.length), 0);
    lengths.writeBigUInt64BE(BigInt(ciphertext.length), 8);
    lengths.writeBigUInt64BE(BigInt(tagLength), 16);
    const tag = createHmac('sha512', keys.key.subarray(32))
        .update(lengths).update(nonce).update(aad).update(ciphertext)
        .digest().subarray(0, tagLength);
    return Buffer.concat([header, ciphertext, tag]);
}

export class SFrameStreamCryptor {
    private counter = 0n;
    private readonly kid: bigint;
    private readonly keys: ReturnType<typeof deriveSFrameKeys>;

    constructor(sendKey: RTCSFrameKey, ssrc: number, private readonly suite: SFrameSuite) {
        this.kid = BigInt(sendKey.kid);
        const key = Buffer.from(sendKey.key, 'base64');
        if (key.length !== 32)
            throw new Error('HomeKit SFrame sender key must be 32 bytes');
        const salt = Buffer.alloc(4);
        salt.writeUInt32BE(ssrc);
        const baseKey = Buffer.from(hkdfSync('sha512', key, salt, Buffer.from('SFrame 1.0 RTP Stream'), 64));
        this.keys = deriveSFrameKeys(baseKey, this.kid, suite);
    }

    protectFrame(plaintext: Buffer): Buffer {
        // Exhaustion must fail rather than reuse a nonce with the same key.
        const counter = this.counter++;
        return protectSFrame(this.keys, this.suite, this.kid, counter, plaintext);
    }
}
