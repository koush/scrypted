// by @dgrief from @homebridge/camera-utils

export function isRtpMessagePayloadType(payloadType: number) {
    return payloadType > 90 || payloadType === 0
}

export function getPayloadType(message: Buffer) {
    return message.readUInt8(1) & 0x7f
}

export function getSequenceNumber(message: Buffer) {
    return message.readUInt16BE(2)
}
