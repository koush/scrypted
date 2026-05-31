import { reservePorts } from './port-utils';
import { createBindUdp, createBindZero } from '@scrypted/common/src/listen-cluster';
import dgram from 'dgram';
import { ReplaySubject, timer } from 'rxjs';
import { createStunResponder, RtpDescription, RtpOptions, sendStunBindingRequest } from './rtp-utils';
import { SipManager, SipOptions, SipRequest } from './sip-manager';
import { Subscribed } from './subscribed';

/*
 A SipCallSession 
 */
export class SipCallSession extends Subscribed {
  private hasStarted = false
  private hasCallEnded = false
  private onCallEndedSubject = new ReplaySubject(1)
  onCallEnded = this.onCallEndedSubject.asObservable()

  constructor(
    private readonly console: Console,
    private readonly sipOptions: SipOptions,
    private readonly rtpOptions: RtpOptions,
    public readonly audioSplitter: dgram.Socket,
    public audioRtcpSplitter: dgram.Socket,
    public readonly videoSplitter: dgram.Socket,
    public videoRtcpSplitter: dgram.Socket,
    public readonly cameraName: string,
    private sipManager: SipManager
  ) {
    super()
    if( !this.sipManager ) {
      this.sipManager = this.createSipManager( sipOptions )
    }
    //TODO: make this more clean
    this.addSubscriptions( this.sipManager.onEndedByRemote.subscribe(() => {
      this.callEnded(false)
    } ))
    
    this.sipManager.setSipOptions( sipOptions )
  }

  static async createCallSession(console: Console, cameraName: string, sipOptions: SipOptions, sipManager?: SipManager ) {
    const audioSplitter = await createBindZero(),
    audioRtcpSplitter = await createBindUdp(audioSplitter.port + 1),
    videoSplitter = await createBindZero(),
    videoRtcpSplitter = await createBindUdp(videoSplitter.port + 1),
    rtpOptions : RtpOptions = {
      audio: {
        port: audioSplitter.port,
        rtcpPort: audioRtcpSplitter.port,
        //TODO: make this cleaner
        srtpKey: undefined,
        srtpSalt: undefined
      },
      video: {
        port: videoSplitter.port,
        rtcpPort: videoRtcpSplitter.port,
        //TODO: make this cleaner
        srtpKey: undefined,
        srtpSalt: undefined 
      }
    }

    return new SipCallSession(
      console,
      sipOptions,
      rtpOptions,
      audioSplitter.server,
      audioRtcpSplitter.server,
      videoSplitter.server,
      videoRtcpSplitter.server,
      cameraName,
      sipManager
    )
  }

  createSipManager(sipOptions: SipOptions) {
    if (this.sipManager) {
      this.sipManager.destroy()
    }

    const call = (this.sipManager = new SipManager(
      this.console,
      sipOptions
    ))

    this.addSubscriptions(
      call.onEndedByRemote.subscribe(() => {
        this.callEnded(false)
      } )
    )

    return this.sipManager
  }

  async call( audioSection, videoSection? ): Promise<RtpDescription> {
    return this.callOrAcceptInvite(audioSection, videoSection)
  }

  async callOrAcceptInvite( audioSection, videoSection?, incomingCallRequest? : SipRequest ): Promise<RtpDescription> {
    this.console.log(`SipSession::start()`);

    if (this.hasStarted) {
      throw new Error('SIP Session has already been started')
    }
    this.hasStarted = true

    if (this.hasCallEnded) {
      throw new Error('SIP Session has already ended')
    }

    try {
      const rtpDescription : RtpDescription = await this.sipManager.invite( this.rtpOptions, audioSection, videoSection, incomingCallRequest ),
        sendStunRequests = () => {
          sendStunBindingRequest({
            rtpSplitter: this.audioSplitter,
            rtcpSplitter: this.audioRtcpSplitter,
            rtpDescription,
            localUfrag: this.sipManager.audioUfrag,
            type: 'audio',
          })
          sendStunBindingRequest({
            rtpSplitter: this.videoSplitter,
            rtcpSplitter: this.videoRtcpSplitter,
            rtpDescription,
            localUfrag: this.sipManager.videoUfrag,
            type: 'video',
          })
        }

      // if rtcp-mux is supported, rtp splitter will be used for both rtp and rtcp
      if ( rtpDescription.audio.port > 0 && rtpDescription.audio.port === rtpDescription.audio.rtcpPort) {
        this.audioRtcpSplitter.close()
        this.audioRtcpSplitter = this.audioSplitter
      }

      if ( rtpDescription.video.port > 0 && rtpDescription.video.port === rtpDescription.video.rtcpPort) {
        this.videoRtcpSplitter.close()
        this.videoRtcpSplitter = this.videoSplitter
      }

      if ( (rtpDescription.audio.port > 0 && rtpDescription.audio.iceUFrag)|| (rtpDescription.video.port > 0 && rtpDescription.video.iceUFrag ) ) {
        // ICE is supported
        this.console.log(`Connecting to ${this.cameraName} using ICE`)
        if( rtpDescription.audio.port > 0 ) {
          createStunResponder(this.audioSplitter)
        }
        if( rtpDescription.video.port > 0 ) {
          createStunResponder(this.videoSplitter)
        }

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
        this.console.log(`Audio stream latched for ${this.cameraName}, port: ${this.rtpOptions.audio.port}`)
      })

      this.videoSplitter.once('message', () => {
        this.console.log(`Video stream latched for ${this.cameraName}, port: ${this.rtpOptions.video.port}`)
      })

      return rtpDescription
    } catch (e) {
      this.callEnded(true)
      throw e
    }
  }

  static async reserveRtpRtcpPorts() {
    const ports = await reservePorts({ count: 4, type: 'udp' })
    return ports
  }

  private async callEnded(sendBye: boolean) {
    if (this.hasCallEnded) {
      return
    }
    
    this.hasCallEnded = true
    if (sendBye) {
      await this.sipManager.sendBye().catch(this.console.error)
    }
    
    // clean up
    this.console.log("sip-call-session callEnded")
    this.onCallEndedSubject.next(null)
    //this.sipManager.destroy()
    this.audioSplitter.close()
    this.audioRtcpSplitter.close()
    this.videoSplitter.close()
    this.videoRtcpSplitter.close()
    this.unsubscribe()
    this.console.log("sip-call-session callEnded: done")
  }

  async stop() {
    await this.callEnded(true)
  }
}