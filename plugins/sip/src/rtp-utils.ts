// by @dgrief from @homebridge/camera-utils
import dgram from 'dgram'
const stun = require('stun')

const stunMagicCookie = 0x2112a442 // https://tools.ietf.org/html/rfc5389#section-6

export interface SrtpOptions {
  srtpKey: Buffer
  srtpSalt: Buffer
}

export interface RtpStreamOptions extends SrtpOptions {
  port: number
  rtcpPort: number
}

export interface RtpOptions {
  audio: RtpStreamOptions
  video: RtpStreamOptions
}

export interface RtpStreamDescription extends RtpStreamOptions {
  ssrc?: number
  iceUFrag?: string
  icePwd?: string
}

export interface RtpDescription {
  address: string
  audio: RtpStreamDescription
  video: RtpStreamDescription
  sdp: string
}

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

export function sendStunBindingRequest({
  rtpDescription,
  rtpSplitter,
  rtcpSplitter,
  localUfrag,
  type,
}: {
  rtpSplitter: dgram.Socket
  rtcpSplitter: dgram.Socket
  rtpDescription: RtpDescription
  localUfrag?: string
  type: 'audio' | 'video'
}) {
  const  remoteDescription = rtpDescription[type];
  if( remoteDescription.port == 0 )
    return;
  const message = stun.createMessage(1),
    { address } = rtpDescription,
    { iceUFrag, icePwd, port, rtcpPort } = remoteDescription

  if (iceUFrag && icePwd && localUfrag) {
    // Full ICE supported.  Send as formal stun request
    message.addUsername(iceUFrag + ':' + localUfrag)
    message.addMessageIntegrity(icePwd)

    stun
      .request(`${address}:${port}`, {
        socket: rtpSplitter,
        message,
      })
      .then(() => console.debug(`${type} stun complete`))
      .catch((e: Error) => {
        console.error(`${type} stun error`)
        console.error(e)
      })
  } else {
    // ICE not supported.  Fire and forget the stun request for RTP and RTCP
    const encodedMessage = stun.encode(message)
    try {
      rtpSplitter.send(encodedMessage, port, address)
    } catch (e) {
      console.error(e)
    }

    try {
      rtcpSplitter.send(encodedMessage, rtcpPort, address)
    } catch (e) {
      console.error(e)
    }
  }
}

export function createStunResponder(rtpSplitter: dgram.Socket) {
  return rtpSplitter.on('message', (message, info) => {
    if (!isStunMessage(message)) {
      return null
    }

    try {
      const decodedMessage = stun.decode(message),
        response = stun.createMessage(
          stun.constants.STUN_BINDING_RESPONSE,
          decodedMessage.transactionId
        )

      response.addXorAddress(info.address, info.port)
      try {
        rtpSplitter.send(stun.encode(response), info.port, info.address)
      } catch (e) {
        console.error(e)
      }
    } catch (e) {
      console.debug('Failed to Decode STUN Message')
      console.debug(message.toString('hex'))
      console.debug(e)
    }

    return null
  })
}
