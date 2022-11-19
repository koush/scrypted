import { ReplaySubject, timer } from 'rxjs'
import { once } from 'events'
import { createStunResponder, RtpDescription, RtpOptions, sendStunBindingRequest } from './rtp-utils'
import { reservePorts } from '@homebridge/camera-utils';
import { SipCall, SipOptions } from './sip-call'
import { Subscribed } from './subscribed'
import dgram from 'dgram'

export async function bindUdp(server: dgram.Socket, usePort: number) {
  server.bind({
    port: usePort,
    // exclusive: false,
    // address: '0.0.0.0',
  })
  await once(server, 'listening')
  server.setRecvBufferSize(1024 * 1024)
  const port = server.address().port
  return {
    port,
    url: `udp://'0.0.0.0':${port}`,
  }
}

export async function createBindUdp(usePort: number) {
  const server = dgram.createSocket({
      type: 'udp4',
      // reuseAddr: true,
    }),
    { port, url } = await bindUdp(server, usePort)
  return {
    server,
    port,
    url,
  }
}

export class SipSession extends Subscribed {
  private hasStarted = false
  private hasCallEnded = false
  private onCallEndedSubject = new ReplaySubject(1)
  private sipCall: SipCall
  onCallEnded = this.onCallEndedSubject.asObservable()

  constructor(
    public readonly console: any,
    public readonly sipOptions: SipOptions,
    public readonly rtpOptions: RtpOptions,
    public readonly audioSplitter: dgram.Socket,
    public audioRtcpSplitter: dgram.Socket,
    public readonly cameraName: string
  ) {
    super()

    this.sipCall = this.createSipCall(this.sipOptions)
  }

  static async createSipSession(console: any, cameraName: string, sipOptions: SipOptions) {
    const audioPort = 0,
      audioSplitter = await createBindUdp(audioPort),
      audioRtcpSplitter = await createBindUdp(audioSplitter.port + 1),
      rtpOptions = {
        audio: {
          port: audioSplitter.port,
          rtcpPort: audioRtcpSplitter.port
        }
      }

    return new SipSession(
      console,
      sipOptions,
      rtpOptions,
      audioSplitter.server,
      audioRtcpSplitter.server,
      cameraName
    )
  }

  createSipCall(sipOptions: SipOptions) {
    if (this.sipCall) {
      this.sipCall.destroy()
    }

    const call = (this.sipCall = new SipCall(
      this.console,
      sipOptions,
      this.rtpOptions
    ))

    this.addSubscriptions(
      call.onEndedByRemote.subscribe(() => this.callEnded(false))
    )

    return this.sipCall
  }

  async start(): Promise<RtpDescription> {
    this.console.log(`SipSession::start()`);

    if (this.hasStarted) {
      throw new Error('SIP Session has already been started')
    }
    this.hasStarted = true

    if (this.hasCallEnded) {
      throw new Error('SIP Session has already ended')
    }

    try {
      const rtpDescription = await this.sipCall.invite(),
      sendStunRequests = () => {
        sendStunBindingRequest({
          rtpSplitter: this.audioSplitter,
          rtcpSplitter: this.audioRtcpSplitter,
          rtpDescription,
          localUfrag: this.sipCall.audioUfrag,
          type: 'audio',
        })
      }

      // if rtcp-mux is supported, rtp splitter will be used for both rtp and rtcp
      if (rtpDescription.audio.port === rtpDescription.audio.rtcpPort) {
        this.audioRtcpSplitter.close()
        this.audioRtcpSplitter = this.audioSplitter
      }

      if (rtpDescription.audio.iceUFrag) {
        // ICE is supported
        this.console.log(`Connecting to ${this.cameraName} using ICE`)
        createStunResponder(this.audioSplitter)

        sendStunRequests()
      } else {
        // ICE is not supported, use stun as keep alive
        this.console.log(`Connecting to ${this.cameraName} using STUN`)
        this.addSubscriptions(
          // hole punch every .5 seconds to keep stream alive and port open (matches behavior from Ring app)
          timer(0, 500).subscribe(sendStunRequests)
        )
      }

      this.audioSplitter.once('message', () => {
        this.console.log(`Audio stream latched for ${this.cameraName}`)
      })

      return rtpDescription
    } catch (e) {

      this.callEnded(true)
      throw e
    }
  }

  async reservePort(bufferPorts = 0) {
    const ports = await reservePorts({ count: bufferPorts + 1 })
    return ports[0]
  }

  private async callEnded(sendBye: boolean) {
    if (this.hasCallEnded) {
      return
    }
    this.hasCallEnded = true

    if (sendBye) {
      await this.sipCall.sendBye().catch(this.console.log)
    }

    // clean up
    this.onCallEndedSubject.next(null)
    this.sipCall.destroy()
    this.audioSplitter.close()
    this.audioRtcpSplitter.close()   
    this.unsubscribe()
  }

  async stop() {
    await this.callEnded(true)
  }
}