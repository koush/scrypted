// XOR-AB autokey cipher used by all Kasa "smarthome" endpoints (UDP/9999 discovery,
// the LINKIE2 control protocol). Initial key 0xAB; each output byte becomes the next key,
// so encrypt and decrypt only differ in which side feeds the key forward (the cipher byte
// in both cases — the same primitive, just different direction).

export function xorEncrypt(plaintext: Buffer): Buffer {
    const out = Buffer.allocUnsafe(plaintext.length);
    let key = 0xAB;
    for (let i = 0; i < plaintext.length; i++) {
        const c = key ^ plaintext[i];
        out[i] = c;
        key = c;
    }
    return out;
}

export function xorDecrypt(ciphertext: Buffer): Buffer {
    const out = Buffer.allocUnsafe(ciphertext.length);
    let key = 0xAB;
    for (let i = 0; i < ciphertext.length; i++) {
        const c = ciphertext[i];
        out[i] = key ^ c;
        key = c;
    }
    return out;
}

// In-place variants — overwrite the input buffer instead of allocating a fresh one. Use
// when the caller owns the input (e.g., a freshly-allocated Buffer.from(...) it's about
// to throw away). Saves an allocation + copy on every encrypt/decrypt pair.
export function xorEncryptInPlace(plaintext: Buffer): Buffer {
    let key = 0xAB;
    for (let i = 0; i < plaintext.length; i++) {
        const c = key ^ plaintext[i];
        plaintext[i] = c;
        key = c;
    }
    return plaintext;
}

export function xorDecryptInPlace(ciphertext: Buffer): Buffer {
    let key = 0xAB;
    for (let i = 0; i < ciphertext.length; i++) {
        const c = ciphertext[i];
        ciphertext[i] = key ^ c;
        key = c;
    }
    return ciphertext;
}
