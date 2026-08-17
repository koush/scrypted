import crypto from 'crypto';

// The Baichuan protocol's legacy XML XOR cipher uses this fixed 8-byte key,
// cycled and additionally XORed with the low byte of the packet offset.
const BC_XML_KEY = Buffer.from([0x1f, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78, 0xff]);

// Baichuan's AES payloads always use this literal ASCII string as the IV,
// regardless of device or session.
const AES_IV = Buffer.from('0123456789abcdef');

export enum EncryptionMode {
    None = 'none',
    BC = 'bc',
    AES = 'aes',
}

/**
 * The classic Baichuan XML XOR cipher (a.k.a. "BCEncrypt"). Symmetric: the
 * same function encrypts and decrypts. `offset` is the packet's channel id /
 * encryption-offset header byte.
 */
export function bcXor(data: Buffer, offset: number): Buffer {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
        const key = BC_XML_KEY[(offset + i) % BC_XML_KEY.length];
        out[i] = data[i] ^ key ^ (offset & 0xff);
    }
    return out;
}

/**
 * MD5 hex digest, uppercased, with Reolink's "modern" login truncation
 * quirk applied: only the first 31 of the 32 hex characters are kept. This
 * matches the firmware's own (buggy) legacy C string handling, and both the
 * username and password sent in the modern LoginUser XML must be hashed
 * this way for the login to be accepted.
 */
export function md5Truncated(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex').toUpperCase().slice(0, 31);
}

/**
 * Derives the AES-128 session key from the login nonce and the plaintext
 * password: MD5("<nonce>-<password>"), hex-encoded and uppercased, then the
 * first 16 *characters* of that hex string are used verbatim as the 16 raw
 * key bytes (not hex-decoded). This is Reolink's own scheme and was
 * confirmed against a live device and cross-checked against the go2rtc
 * Baichuan implementation.
 */
export function deriveAesKey(nonce: string, password: string): Buffer {
    const digest = crypto.createHash('md5').update(`${nonce}-${password}`).digest('hex').toUpperCase();
    return Buffer.from(digest.slice(0, 16), 'ascii');
}

/**
 * AES-128-CFB (full 128-bit segment feedback, i.e. plain "aes-128-cfb" in
 * OpenSSL/Node terms) with the fixed Baichuan IV. Each call creates a fresh
 * cipher/decipher instance: Baichuan does not maintain a running keystream
 * across messages, every message is encrypted independently with the same
 * key and IV.
 */
export function aesCfbEncrypt(key: Buffer, data: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-cfb', key, AES_IV);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function aesCfbDecrypt(key: Buffer, data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('aes-128-cfb', key, AES_IV);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Encrypts an XML payload for the wire, per the negotiated encryption mode.
 * `offset` is the channel id byte from the packet header (used only by the
 * BC XOR cipher; ignored for AES).
 */
export function encryptXml(mode: EncryptionMode, key: Buffer | undefined, offset: number, data: Buffer): Buffer {
    switch (mode) {
        case EncryptionMode.None:
            return Buffer.from(data);
        case EncryptionMode.BC:
            return bcXor(data, offset);
        case EncryptionMode.AES:
            // Falls back to BC XOR if the AES key has not been established yet,
            // matching the observed firmware behavior for out-of-order packets.
            return key ? aesCfbEncrypt(key, data) : bcXor(data, offset);
    }
}

export function decryptXml(mode: EncryptionMode, key: Buffer | undefined, offset: number, data: Buffer): Buffer {
    switch (mode) {
        case EncryptionMode.None:
            return Buffer.from(data);
        case EncryptionMode.BC:
            return bcXor(data, offset);
        case EncryptionMode.AES:
            return key ? aesCfbDecrypt(key, data) : bcXor(data, offset);
    }
}
