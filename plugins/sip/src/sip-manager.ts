import { noop, Subject } from 'rxjs'
import { randomInteger, randomString } from './util'
import { RtpDescription, RtpOptions, RtpStreamDescription } from './rtp-utils'
import { decodeSrtpOptions } from '../../ring/src/srtp-utils'
import { stringify } from '@slyoldfox/sip'
import { timeoutPromise } from '@scrypted/common/src/promise-utils';
import sdp from 'sdp'

const sip = require('@slyoldfox/sip')

export interface SipOptions {
  to: string
  from: string
  domain?: string
  expire?: number
  localIp: string
  localPort: number
  debugSip?: boolean
  useTcp?: boolean
  gruuInstanceId?: string
  sipRequestHandler?: SipRequestHandler
}

/**
 * Allows handling of SIP messages
 */
export abstract class SipRequestHandler {
  abstract handle( request: SipRequest )
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
    method: string,
    extension?: {
      headers: Partial<SipHeaders>,
      content
    }
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
        rtcpPort: 0,
        srtpKey: undefined,
        srtpSalt: undefined
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
    encodedCrypto = cryptoLine?.match(/inline:(\S*)/)![1] || undefined

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
      ...(encodedCrypto? decodeSrtpOptions(encodedCrypto) : { srtpKey: undefined, srtpSalt: undefined })
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

export class SipManager {
  private seq = 20
  private fromParams = { tag: getRandomId() }
  private toParams: { tag?: string } = {}
  private callId = getRandomId()
  private sipStack: SipStack
  public readonly onEndedByRemote = new Subject()
  private destroyed = false
  private readonly console: Console

  public readonly audioUfrag = randomString(16)
  public readonly videoUfrag = randomString(16)

  constructor(
    console: Console,
    private sipOptions: SipOptions,
  ) {
    this.console = console;
    const host = this.sipOptions.localIp,
    port = this.sipOptions.localPort

    this.sipStack = {
      makeResponse: sip.makeResponse,
      ...sip.create({
        host,
        hostname: host,
        port: port,
        udp: !this.sipOptions.useTcp,
        tcp: this.sipOptions.useTcp,
        tls: false,
        // tls_port: tlsPort,
        // tls: {
        //   rejectUnauthorized: false,
        // },
        ws: false,
        logger: {
          error: function(e) {
            if( sipOptions.debugSip ) console.error(e)
          },
          recv:  function(m, remote) {
            if( (m.status == '200' || m.method === 'INVITE' ) && m.headers && m.headers.cseq && m.headers.cseq.method === 'INVITE' && m.headers.contact && m.headers.contact[0] ) {
              // ACK for INVITE and BYE must use the registrar contact uri
              this.registrarContact = m.headers.contact[0].uri;
            }
            if( sipOptions.debugSip ) {
              console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")
              console.log(stringify( m ));
              console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<")
            }
          },
          appendGruu: function( contact, gruuUrn ) {
            if( sipOptions.gruuInstanceId ) {
              if( contact && contact[0] ) {
                if( !contact[0].params ) {
                 contact[0].params = {}
                }
                contact[0].params['+sip.instance'] = '"<urn:uuid:' + sipOptions.gruuInstanceId + '>"'
                if( gruuUrn ) {
                  contact[0].uri = contact[0].uri + ';gr=urn:uuid:' + sipOptions.gruuInstanceId
                }
              }
            }            
          },
          send:  function(m, remote) {
            /*
            Some door bells run an embedded SIP server with an unresolvable public domain
            Due to bugs in the DNS resolution in sip/sip we abuse the 'send' logger to modify some headers
            just before they get sent to the SIP server.
            */
           if( sipOptions.domain && sipOptions.domain.length > 0 ) {
              // Bticino CX300 specific: runs on an internet 2048362.bs.iotleg.com domain
              // While underlying UDP socket is bound to the IP, the header is rewritten to match the domain
              let toWithDomain: string = (sipOptions.to.split('@')[0] + '@' + sipOptions.domain).trim()
              let fromWithDomain: string = (sipOptions.from.split('@')[0] + '@' + sipOptions.domain).trim()

              if( m.method == 'REGISTER' ) {
                m.uri = "sip:" + sipOptions.domain
                m.headers.to.uri = fromWithDomain
                this.appendGruu( m.headers.contact )
              } else if( m.method == 'INVITE' || m.method == 'MESSAGE' ) {
                m.uri = toWithDomain
                m.headers.to.uri = toWithDomain
                if( m.method == 'MESSAGE' && m.headers.to ) {
                  m.headers.to.params = null;
                }
              } else if( m.method == 'ACK' || m.method == 'BYE' ) {
                m.headers.to.uri = toWithDomain
                if(this.registrarContact)
                    m.uri = this.registrarContact
              } else if( (m.method == undefined && m.status) && m.headers.cseq ) {
                if( m.status == '200' ) {
                  // Response on invite
                  this.appendGruu( m.headers.contact, true )
                }
                
                // 183, 200, OK, CSeq: INVITE
              } else {
                console.error("Error: Method construct for uri not implemented: " + m.method)
              }

              if( m.method ) {
                m.headers.from.uri = fromWithDomain
                if( m.headers.contact && m.headers.contact[0].uri.split('@')[0].lastIndexOf('-') < 0 ) {
                  // Also a bug in SIP.js ? append the transport for the contact if the transport is udp (according to RFC)
                  if( remote.protocol != 'udp' && m.headers.contact[0].uri.indexOf( "transport=" ) < 0 ) {
                    m.headers.contact[0].uri = m.headers.contact[0].uri + ";transport=" + remote.protocol
                  }
                }
              }
            }

            if( sipOptions.debugSip ) {
              console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
              if( m.uri ) {
                console.log(stringify( m ));
              } else {
                m.uri = '';
                console.log( stringify( m ) )
              }
              
              console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
            }
          },
        },
      },
        (request: SipRequest) => {
          if (request.method === 'BYE') {
            this.console.info('received BYE from remote end')
            this.sipStack.send(this.sipStack.makeResponse(request, 200, 'Ok'))

            if (!this.destroyed) {
              this.onEndedByRemote.next(null)
            }
          } else if( request.method === 'MESSAGE'  && sipOptions.sipRequestHandler ) {
            sipOptions.sipRequestHandler.handle( request )
            this.sipStack.send(this.sipStack.makeResponse(request, 200, 'Ok'))
          } else if( request.method === 'INVITE' && sipOptions.sipRequestHandler ) {
            //let tryingResponse = this.sipStack.makeResponse( request, 100, 'Trying' )
            //this.sipStack.send(tryingResponse)            
              //TODO: sporadic re-INVITEs are possible and should reply with 486 Busy here if already being handled
              let ringResponse = this.sipStack.makeResponse(request, 180, 'Ringing')
              this.toParams.tag = getRandomId()
              ringResponse.headers.to.params.tag = this.toParams.tag
              ringResponse.headers["record-route"] = request.headers["record-route"];
              ringResponse.headers["supported"] = "replaces, outbound, gruu"
              // Can include SDP and could send 183 here for early media
              this.sipStack.send(ringResponse)
  
              sipOptions.sipRequestHandler.handle( request )
           // }, 100 )
          } else if( request.method === 'CANCEL' || request.method === 'ACK' ) {
            sipOptions.sipRequestHandler.handle( request )
          } else {
            if( sipOptions.debugSip ) {
              this.console.warn("unimplemented method received from remote: " + request.method)
            }
          }
        }
        )
    }
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
          
          if (response.headers.from.params && response.headers.from.params.tag) {
            this.fromParams.tag = response.headers.from.params.tag
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

  public setSipOptions( sipOptions : SipOptions ) {
    this.sipOptions = sipOptions
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

  /**
  * Initiate a call by sending a SIP INVITE request
  */
  async invite( rtpOptions : RtpOptions, audioSection, videoSection?, incomingCallRequest? ) : Promise<RtpDescription> {
    let ssrc = randomInteger()
    let audio = audioSection ? audioSection( rtpOptions.audio, ssrc ).concat( ...[`a=rtcp:${rtpOptions.audio.rtcpPort}`] ) : []
    let video = videoSection ? videoSection( rtpOptions.video, ssrc ).concat( ...[`a=rtcp:${rtpOptions.video.rtcpPort}`] ) : []
    const { from, localIp } = this.sipOptions;


    if( incomingCallRequest ) {
      let callResponse = this.sipStack.makeResponse(incomingCallRequest, 200, 'Ok', {
        headers: {
          supported: 'replaces, outbound, gruu',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'application/sdp',
        },
        content:  ([
          'v=0',
          `o=${from.split(':')[1].split('@')[0]} 3747 461 IN IP4 ${localIp}`,
          's=ScryptedSipPlugin',
          `c=IN IP4 ${this.sipOptions.localIp}`,
          't=0 0',
          ...audio,
          ...video
          ]
          .filter((l) => l)
          .join('\r\n')) + '\r\n'
      } )
      if( incomingCallRequest.headers["record-route"] )
        callResponse.headers["record-route"] = incomingCallRequest.headers["record-route"];
      let fromWithDomain: string = (from.split('@')[0] + '@' + this.sipOptions.domain).trim()
      callResponse.headers.contact = [{ uri: fromWithDomain }]

      // Invert the params if the request comes from the server
      this.fromParams.tag = incomingCallRequest.headers.to.params.tag
      this.toParams.tag = incomingCallRequest.headers.from.params.tag
      this.callId = incomingCallRequest.headers["call-id"]
      
      await this.sipStack.send(callResponse)

      return parseRtpDescription(this.console, incomingCallRequest)
    } else {
      let inviteResponse = await this.request({
        method: 'INVITE',
        headers: {
          supported: 'replaces, outbound, gruu',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'application/sdp',
          contact: [{ uri: from }],
        },
        content: ([
          'v=0',
          `o=${from.split(':')[1].split('@')[0]} 3747 461 IN IP4 ${localIp}`,
          's=ScryptedSipPlugin',
          `c=IN IP4 ${this.sipOptions.localIp}`,
          't=0 0',
          ...audio,
          ...video
          ]
          .filter((l) => l)
          .join('\r\n')) + '\r\n'
      })

      return parseRtpDescription(this.console, inviteResponse)
    }
  }

  /**
  * Register the user agent with a Registrar
  */
  async register() : Promise<void> {
    const { from } = this.sipOptions;
    await timeoutPromise( 3000,
      this.request({
      method: 'REGISTER',
      headers: {
        supported: 'replaces, outbound, gruu',
        allow:
          'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
        contact: [{ uri: from }],
        expires: this.sipOptions.expire // as seen in tcpdump for Door Entry app
      },
      }).catch(noop));
  }

  /**
  * Send a message to the current call contact
  */
  async message( content: string ) : Promise<SipResponse> {
    const { from } = this.sipOptions,
    messageResponse = await this.request({
        method: 'MESSAGE',
        headers: {
          //supported: 'replaces, outbound',
          allow:
            'INVITE, ACK, CANCEL, OPTIONS, BYE, REFER, NOTIFY, MESSAGE, SUBSCRIBE, INFO, UPDATE',
          'content-type': 'text/plain',
          contact: [{ uri: from, params: { expires: this.sipOptions.expire } }],
        },
        content: content
      });
      return messageResponse;
  }

  async sendBye() : Promise<void | SipResponse> {
    this.console.log('Sending BYE...')
    return await timeoutPromise( 3000, this.request({ method: 'BYE' }).catch(() => {
      // Don't care if we get an exception here.
    }));
  }

  destroy() {
    this.console.debug("detroying sip-manager")
    this.destroyed = true
    this.sipStack.destroy()
    this.console.debug("detroying sip-manager: done")
  }
}


