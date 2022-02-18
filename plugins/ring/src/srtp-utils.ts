// by @dgrief from @homebridge/camera-utils

export interface SrtpOptions {
    srtpKey: Buffer
    srtpSalt: Buffer
}

export function encodeSrtpOptions({ srtpKey, srtpSalt }: SrtpOptions) {
    return Buffer.concat([srtpKey, srtpSalt]).toString('base64')
}

export function decodeSrtpOptions(encodedOptions: string): SrtpOptions {
    const crypto = Buffer.from(encodedOptions, 'base64')

    return {
        srtpKey: crypto.slice(0, 16),
        srtpSalt: crypto.slice(16, 30),
    }
}

export function createCryptoLine(srtpOptions: SrtpOptions) {
    const encodedOptions = encodeSrtpOptions(srtpOptions)

    return `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${encodedOptions}`
}
