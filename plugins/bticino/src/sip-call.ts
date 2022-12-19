import { noop, Subject } from 'rxjs'
import { randomInteger, randomString } from '../../sip/src/util'
import { RtpDescription, RtpOptions, RtpStreamDescription } from '../../sip/src/rtp-utils'
import { stringify } from 'sip/sip'
import { decodeSrtpOptions } from '../../ring/src/srtp-utils'

const contactId = randomInteger();

const sip = require('sip'),
  sdp = require('sdp')

export interface SipOptions {
  to: string
  from: string
  domain: string
  expire: number
  localIp: string
  localPort: number
  udp: boolean
  tcp: boolean
  debug: boolean
}

interface UriOptions {
  name?: string
  uri: string
  params?: {
     tag?: string
     expires?: number
   }
}

interface SipHeaders {
  [name: string]: string | any
  cseq: { seq: number; method: string }
  to: UriOptions
  from: UriOptions
  contact?: UriOptions[]
  via?: UriOptions[]
}

export interface SipRequest {
  uri: UriOptions | string
  method: string
  headers: SipHeaders
  content: string
}

export interface SipResponse {
  status: number
  reason: string
  headers: SipHeaders
  content: string
}

interface SipStack {
  send: (
    request: SipRequest | SipResponse,
    handler?: (response: SipResponse) => void
  ) => void
  destroy: () => void
  makeResponse: (
    response: SipRequest,
    status: number,
    method: string
  ) => SipResponse
}

function getRandomId() {
  return Math.floor(Math.random() * 1e6).toString()
}

function getRtpDescription(
  console: any,
  sections: string[],
  mediaType: 'audio' | 'video'
): RtpStreamDescription {
  try {
    const section = sections.find((s) => s.startsWith('m=' + mediaType));
    if( section === undefined ) {
      return {
        port: 0,
        rtcpPort: 0
      };
    }

    const { port } = sdp.parseMLine(section),
    lines: string[] = sdp.splitLines(section),
    rtcpLine = lines.find((l: string) => l.startsWith('a=rtcp:')),
    cryptoLine = lines.find((l: string) => l.startsWith('a=crypto'))!,
    rtcpMuxLine = lines.find((l: string) => l.startsWith('a=rtcp-mux')),
    ssrcLine = lines.find((l: string) => l.startsWith('a=ssrc')),
    iceUFragLine = lines.find((l: string) => l.startsWith('a=ice-ufrag')),
    icePwdLine = lines.find((l: string) => l.startsWith('a=ice-pwd')),
    encodedCrypto = cryptoLine.match(/inline:(\S*)/)![1]

    let rtcpPort: number;
    if (rtcpMuxLine) {
      rtcpPort = port; // rtcp-mux would cause rtcpLine to not be present
    }
    else {
      rtcpPort = (rtcpLine && Number(rtcpLine.match(/rtcp:(\S*)/)?.[1])) || port + 1; // if there is no explicit RTCP port, then use RTP port + 1
    }

    return {
      port,
      rtcpPort,
      ssrc: (ssrcLine && Number(ssrcLine.match(/ssrc:(\S*)/)?.[1])) || undefined,
      iceUFrag: (iceUFragLine && iceUFragLine.match(/ice-ufrag:(\S*)/)?.[1]) || undefined,
      icePwd: (icePwdLine && icePwdLine.match(/ice-pwd:(\S*)/)?.[1]) || undefined,
      ...decodeSrtpOptions(encodedCrypto),
    }
  } catch (e) {
    console.error('Failed to parse SDP from remote end')
    console.error(sections.join('\r\n'))
    throw e
  }
}

function parseRtpDescription(console: any, inviteResponse: {
  content: string
}): RtpDescription {
  const sections: string[] = sdp.splitSections(inviteResponse.content),
    lines: string[] = sdp.splitLines(sections[0]),
    cLine = lines.find((line: string) => line.startsWith('c='))!

  return {
    sdp: inviteResponse.content,
    address: cLine.match(/c=IN IP4 (\S*)/)![1],
    audio: getRtpDescription(console, sections, 'audio'),
    video: getRtpDescription(console, sections, 'video')
  }
}

export class SipCall {
  private seq = 20
  private fromParams = { tag: getRandomId() }
  private toParams: { tag?: string } = {}
  private callId = getRandomId()
  private sipStack: SipStack
  public readonly onEndedByRemote = new Subject()
  private destroyed = false
  private readonly console: any

  public readonly sdp: string
  public readonly audioUfrag = randomString(16)
  public readonly videoUfrag = randomString(16)

  constructor(
    console: any,
    private sipOptions: SipOptions,
    rtpOptions: RtpOptions,
    //tlsPort: number
  ) {
    this.console = console;

    const { audio, video } = rtpOptions,
      { from } = this.sipOptions,
      host = this.sipOptions.localIp,
      port = this.sipOptions.localPort,
      ssrc = randomInteger();

    this.sipStack = {
      makeResponse: sip.makeResponse,
      ...sip.create({
        host,
        hostname: host,
        port: port,
        udp: this.sipOptions.udp,
        tcp: this.sipOptions.tcp,
        tls: false,
        logger: {
          recv:  function(m, remote) {
            if( sipOptions.debug ) {
              console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")
              console.log(stringify( m ));
              console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")            
            }
          },
          send:  function(m, remote) {
            let toWithDomain: string = (sipOptions.to.split('@')[0] + '@' + sipOptions.domain).trim()
            let fromWithDomain: string = (sipOptions.from.split('@')[0] + '@' + sipOptions.domain).trim()
            if( m.method == 'REGISTER' || m.method == 'INVITE' ) {
              if( m.method == 'REGISTER' ) {
                m.uri = "sip:" + sipOptions.domain
              } else if( m.method == 'INVITE' ) {
                m.uri = toWithDomain
              } else {
                throw new Error("Error: Method construct for uri not implemented: " + m.method)
              }
              
              m.headers.to.uri = toWithDomain
              m.headers.from.uri = fromWithDomain
              if( m.headers.contact[0].uri.split('@')[0].indexOf('-') < 0 ) {
                m.headers.contact[0].uri = m.headers.contact[0].uri.replace("@", "-" + contactId + "@");
              }
            }
            if( sipOptions.debug ) {
              console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
              console.log(stringify( m ));
              console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");            
            }
          },          
        },
        // tls_port: tlsPort,
        // tls: {
        //   rejectUnauthorized: false,
        // },
        ws: false
      },
        (request: SipRequest) => {
          if (request.method === 'BYE') {
            this.console.info('received BYE from remote end')
            this.sipStack.send(this.sipStack.makeResponse(request, 200, 'Ok'))

            if (this.destroyed) {
              this.onEndedByRemote.next(null)
            }
          }
        }
      )
    }
    this.sdp = ([
      'v=0',
      //`o=- 3747 461 IN IP4 ${host}`,
      `o=${from.split(':')[1].split('@')[0]} 3747 461 IN IP4 ${host}`,
      's=ScryptedSipPlugin',
      `c=IN IP4 ${host}`,
      't=0 0',
      'a=DEVADDR:20',
      `m=audio ${audio.port} RTP/SAVP 97`,
      `a=rtpmap:97 speex/8000`,
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X`,
      `m=video ${video.port} RTP/SAVP 97`,
      `a=rtpmap:97 H264/90000`,
      `a=fmtp:97 profile-level-id=42801F`,
      `a=ssrc:${ssrc}`,
      `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X`,
      'a=recvonly'
    ]
      .filter((l) => l)
      .join('\r\n')) + '\r\n';
  }

  request({
    method,
    headers,
    content,
    seq,
  }: {
    method: string
    headers?: Partial<SipHeaders>
    content?: string
    seq?: number
  }) {
    if (this.destroyed) {
      return Promise.reject(
        new Error('SIP request made after call was destroyed')
      )
    }

    return new Promise<SipResponse>((resolve, reject) => {
      seq = seq || this.seq++
      this.sipStack.send(
        {
          method,
          uri: this.sipOptions.to,
          headers: {
            to: {
              //name: '"Scrypted SIP Plugin Client"',
              uri: this.sipOptions.to,
              params: (method == 'REGISTER' || method == 'INVITE'  ? null : this.toParams),
            },
            from: {
              uri: this.sipOptions.from,
              params: this.fromParams,
            },
            'max-forwards': 70,
            'call-id': this.callId,
            cseq: { seq, method },
            ...headers,
          },
          content: content || '',
        },
        (response: SipResponse) => {
          if (response.headers.to.params && response.headers.to.params.tag) {
            this.toParams.tag = response.headers.to.params.tag
          }

          if (response.status >= 300) {
            if (response.status !== 408 || method !== 'BYE') {
              this.console.error(
                `sip ${method} request failed with status ` + response.status
              )
            }
            reject(
              new Error(
                `sip ${method} request failed with status ` + response.status
              )
            )
          } else if (response.status < 200) {
            // call made progress, do nothing and wait for another response
            // console.log('call progress status ' + response.status)
          } else {
            if (method === 'INVITE') {
              // The ACK must be sent with every OK to keep the connection alive.
              this.acknowledge(seq!).catch((e) => {
                this.console.error('Failed to send SDP ACK')
                this.console.error(e)
              })
            }
            resolve(response)
          }
        }
      )
    })
  }

  private async acknowledge(seq: number) {
    // Don't wait for ack, it won't ever come back.
    this.request({
      method: 'ACK',
      seq, // The ACK must have the original sequence number.
    }).catch(noop)
  }

  sendDtmf(key: string) {
    return this.request({
      method: 'INFO',
      headers: {
        'Content-Type': 'application/dtmf-relay',
      },
      content: `Signal=${key}\r\nDuration=250`,
    })
  }

  async invite() {
    const { from } = this.sipOptions,
      inviteResponse = await this.request({
        method: 'INVITE',
        headers: {
          supported: 'replaces, outbound',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'application/sdp',
          contact: [{ uri: from }],
        },
        content: this.sdp,
      })
    return parseRtpDescription(this.console, inviteResponse)
  }

  async register() {
    const { from } = this.sipOptions,
      inviteResponse = await this.request({
        method: 'REGISTER',
        headers: {
          //supported: 'replaces, outbound',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'application/sdp',
          contact: [{ uri: from, params: { expires: this.sipOptions.expire } }],
        },
      });
  }

  async sendBye() {
    this.console.log('Sending BYE...')
    return this.request({ method: 'BYE' }).catch(() => {
      // Don't care if we get an exception here.
    })
  }

  destroy() {
    this.console.debug("detroying sip-call")
    this.destroyed = true
    this.sipStack.destroy()
    this.console.debug("detroying sip-call: done")
  }
}