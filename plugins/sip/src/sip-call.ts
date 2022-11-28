import { noop, Subject } from 'rxjs'
import { randomInteger, randomString } from './util'
import { RtpDescription, RtpOptions, RtpStreamDescription } from './rtp-utils'

const sip = require('sip'),
  sdp = require('sdp')

export interface SipOptions {
  to: string
  from: string
  localIp: string
  localPort: number
}

interface UriOptions {
  name?: string
  uri: string
  params?: { tag?: string }
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
  mediaType: 'audio'
): RtpStreamDescription {
  try {
    const section = sections.find((s) => s.startsWith('m=' + mediaType)),
      { port } = sdp.parseMLine(section),
      lines: string[] = sdp.splitLines(section),
      rtcpLine = lines.find((l: string) => l.startsWith('a=rtcp:')),
      rtcpMuxLine = lines.find((l: string) => l.startsWith('a=rtcp-mux')),
      ssrcLine = lines.find((l: string) => l.startsWith('a=ssrc')),
      iceUFragLine = lines.find((l: string) => l.startsWith('a=ice-ufrag')),
      icePwdLine = lines.find((l: string) => l.startsWith('a=ice-pwd'))

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
    audio: getRtpDescription(console, sections, 'audio')
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

    const { audio } = rtpOptions,
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
        udp: true,
        tcp: false,
        tls: false,
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
      `o=${from.split(':')[1].split('@')[0]} 3747 461 IN IP4 ${host}`,
      's=ScryptedSipPlugin',
      `c=IN IP4 ${host}`,
      't=0 0',
      `m=audio ${audio.port} RTP/AVP 0`,
      'a=rtpmap:0 PCMU/8000',
      `a=rtcp:${audio.rtcpPort}`,
      `a=ssrc:${ssrc}`,
      'a=sendrecv'
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
              name: '"Scrypted SIP Plugin Client"',
              uri: this.sipOptions.to,
              params: this.toParams,
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

  async sendBye() {
    this.console.log('Sending BYE...')
    return this.request({ method: 'BYE' }).catch(() => {
      // Don't care if we get an exception here.
    })
  }

  destroy() {
    this.destroyed = true
    this.sipStack.destroy()
  }
}
