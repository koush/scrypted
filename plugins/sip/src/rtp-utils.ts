// by @dgrief from @homebridge/camera-utils

const stunMagicCookie = 0x2112a442 // https://tools.ietf.org/html/rfc5389#section-6

export function isRtpMessagePayloadType(payloadType: number) {
    return payloadType > 90 || payloadType === 0
}

export function getPayloadType(message: Buffer) {
    return message.readUInt8(1) & 0x7f
}

export function getSequenceNumber(message: Buffer) {
    return message.readUInt16BE(2)
}

export function isStunMessage(message: Buffer) {
    return message.length > 8 && message.readInt32BE(4) === stunMagicCookie
}
  