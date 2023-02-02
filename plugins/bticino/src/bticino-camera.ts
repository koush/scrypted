import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import sdk, { BinarySensor, Camera, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, PictureOptions, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { SipCallSession } from '../../sip/src/sip-call-session';
import { isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType, RtpDescription } from '../../sip/src/rtp-utils';
import { VoicemailHandler } from './bticino-voicemailHandler';
import { CompositeSipMessageHandler } from '../../sip/src/compositeSipMessageHandler';
import { decodeSrtpOptions, encodeSrtpOptions, SrtpOptions } from '../../ring/src/srtp-utils'
import { sleep } from '@scrypted/common/src/sleep';
import { SipHelper } from './sip-helper';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { BticinoStorageSettings } from './storage-settings';
import { BticinoSipPlugin } from './main';
import { BticinoSipLock } from './bticino-lock';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { SipRegisteredSession } from './sip-registered-session';
import { InviteHandler } from './bticino-inviteHandler';

const STREAM_TIMEOUT = 65000;
const { mediaManager } = sdk;

export class BticinoSipCamera extends ScryptedDeviceBase implements DeviceProvider, Intercom, Camera, VideoCamera, Settings, BinarySensor {
    private session: SipCallSession
    private remoteRtpDescription: RtpDescription
    private audioOutForwarder: dgram.Socket
    private audioOutProcess: ChildProcess
    private currentMedia: FFmpegInput | MediaStreamUrl
    private currentMediaMimeType: string
    private refreshTimeout: NodeJS.Timeout
    public requestHandlers: CompositeSipMessageHandler = new CompositeSipMessageHandler()
    private settingsStorage: BticinoStorageSettings = new BticinoStorageSettings( this )
    public voicemailHandler : VoicemailHandler = new VoicemailHandler(this)
    private inviteHandler : InviteHandler = new InviteHandler(this)
    //TODO: randomize this
    private keyAndSalt : string = "/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X"
    private decodedSrtpOptions : SrtpOptions = decodeSrtpOptions( this.keyAndSalt )
    private persistentSipSession : SipRegisteredSession

    constructor(nativeId: string, public provider: BticinoSipPlugin) {
        super(nativeId)
        this.requestHandlers.add( this.voicemailHandler )
        this.requestHandlers.add( this.inviteHandler )
        this.persistentSipSession = new SipRegisteredSession( this )
    }

    sipUnlock(): Promise<void> {
        this.log.i("unlocking C300X door ")
        return this.persistentSipSession.enable().then( (sipCall) => {
            sipCall.message( '*8*19*20##' )
            .then( () =>
                sleep(1000)
                    .then( () => sipCall.message( '*8*20*20##' ) )
            )
        } )
    }

    getAswmStatus() : Promise<void> {
        return this.persistentSipSession.enable().then( (sipCall) => {
            sipCall.message( "GetAswmStatus!" )
        } )        
    }

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The SIP doorbell camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings()
    }
 
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value)
    }    

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.session)
            throw new Error("not in call");

        this.stopIntercom();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const rtpOptions = this.remoteRtpDescription
        const audioOutForwarder = await createBindZero()
        this.audioOutForwarder = audioOutForwarder.server
        audioOutForwarder.server.on('message', message => {
            if( this.session )
                this.session.audioSplitter.send(message, rtpOptions.audio.port, rtpOptions.address)
            return null
        });

        const args = ffmpegInput.inputArguments.slice();
        args.push(
            '-vn', '-dn', '-sn',
            '-acodec', 'speex',
            '-flags', '+global_header',
            '-ac', '1',
            '-ar', '8k',
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', encodeSrtpOptions(this.decodedSrtpOptions),
            `srtp://127.0.0.1:${audioOutForwarder.port}?pkt_size=188`,
        );

        this.console.log("===========================================")
        safePrintFFmpegArguments( this.console, args )
        this.console.log("===========================================")

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
        ffmpegLogInitialOutput(this.console, cp)
        this.audioOutProcess = cp;
        cp.on('exit', () => this.console.log('two way audio ended'));
        this.session.onCallEnded.subscribe(() => {
            closeQuiet(audioOutForwarder.server);
            safeKillFFmpeg(cp)
        });
    }

    async stopIntercom(): Promise<void> {
        closeQuiet(this.audioOutForwarder)
        this.audioOutProcess?.kill('SIGKILL')
        this.audioOutProcess = undefined
        this.audioOutForwarder = undefined
    }

    resetStreamTimeout() {
        this.log.d('starting/refreshing stream')
        clearTimeout(this.refreshTimeout)
        this.refreshTimeout = setTimeout(() => this.stopSession(), STREAM_TIMEOUT)
    }

    stopSession() {
        if (this.session) {
            this.log.d('ending sip session')
            this.session.stop()
            this.session = undefined
        }
    }

    async getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
        if( !SipHelper.sipOptions( this ) ) {
            // Bail out fast when no options are set and someone enables prebuffering
            throw new Error('Please configure from/to/domain settings')
        }

        if (options?.metadata?.refreshAt) {
            if (!this.currentMedia?.mediaStreamOptions)
                throw new Error("no stream to refresh");

            const currentMedia = this.currentMedia
            currentMedia.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
            currentMedia.mediaStreamOptions.metadata = {
                refreshAt: currentMedia.mediaStreamOptions.refreshAt
            };
            this.resetStreamTimeout()
            return mediaManager.createMediaObject(currentMedia, this.currentMediaMimeType)
        }

        this.stopSession();


        const { clientPromise: playbackPromise, port: playbackPort, url: clientUrl } = await listenZeroSingleClient()

        const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000)
            let sip: SipCallSession
            try {
                let rtsp: RtspServer;
                const cleanup = () => {
                    client.destroy();
                    if (this.session === sip)
                        this.session = undefined
                    try {
                        this.log.d('cleanup(): stopping sip session.')
                        sip.stop()
                    }
                    catch (e) {
                    }
                    rtsp?.destroy()
                }

                client.on('close', cleanup)
                client.on('error', cleanup)

                let sipOptions = SipHelper.sipOptions( this )

                // A normal call session doesn't require registering
                sipOptions.shouldRegister = false

                sip = await SipHelper.sipSession( sipOptions )
                // Validate this sooner
                if( !sip ) return Promise.reject("Cannot create session")
                
                sip.onCallEnded.subscribe(cleanup)

                // Call the C300X
                this.remoteRtpDescription = await sip.call(
                    ( audio ) => {
                    return [
                        'a=DEVADDR:20', // Needed for bt_answering_machine (bticino specific)
                        `m=audio ${audio.port} RTP/SAVP 97`,
                        `a=rtpmap:97 speex/8000`,
                        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
                    ]
                }, ( video ) => {
                    return [
                        `m=video ${video.port} RTP/SAVP 97`,
                        `a=rtpmap:97 H264/90000`,
                        `a=fmtp:97 profile-level-id=42801F`,
                        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
                        'a=recvonly'                        
                    ]
                } );
                if( sip.sipOptions.debugSip )
                    this.log.d('SIP: Received remote SDP:\n' + this.remoteRtpDescription.sdp)

                let sdp: string = replacePorts(this.remoteRtpDescription.sdp, 0, 0 )
                sdp = addTrackControls(sdp)
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n')
                if( sip.sipOptions.debugSip )
                    this.log.d('SIP: Updated SDP:\n' + sdp);

                let vseq = 0;
                let vseen = 0;
                let vlost = 0;
                let aseq = 0;
                let aseen = 0;
                let alost = 0;  

                rtsp = new RtspServer(client, sdp, true);
                const parsedSdp = parseSdp(rtsp.sdp);
                const videoTrack = parsedSdp.msections.find(msection => msection.type === 'video').control
                const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control
                if( sip.sipOptions.debugSip ) {
                    rtsp.console = this.console
                }
                
                await rtsp.handlePlayback();
                sip.videoSplitter.on('message', message => {
                    if (!isStunMessage(message)) {
                        const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message))
                        if (!isRtpMessage)
                            return
                        vseen++;
                        rtsp.sendTrack(videoTrack, message, !isRtpMessage)
                        const seq = getSequenceNumber(message)
                        if (seq !== (vseq + 1) % 0x0FFFF)
                            vlost++
                        vseq = seq
                    }
                });

                sip.videoRtcpSplitter.on('message', message => {
                    rtsp.sendTrack(videoTrack, message, true)
                });
                
                sip.audioSplitter.on('message', message => {
                    if (!isStunMessage(message)) {
                        const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message))
                        if (!isRtpMessage)
                            return;
                        aseen++;
                        rtsp.sendTrack(audioTrack, message, !isRtpMessage)
                        const seq = getSequenceNumber(message)
                        if (seq !== (aseq + 1) % 0x0FFFF)
                            alost++;
                        aseq = seq
                    }
                });

                sip.audioRtcpSplitter.on('message', message => {
                    rtsp.sendTrack(audioTrack, message, true)
                });

                this.session = sip

                try {
                    await rtsp.handleTeardown()
                    this.log.d('rtsp client ended')
                }
                catch (e) {
                    this.log.e('rtsp client ended ungracefully' + e);
                }
                finally {
                    cleanup()
                }
            }
            catch (e) {
                sip?.stop()
                throw e;
            }
        });

        this.resetStreamTimeout();

        const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
            refreshAt: Date.now() + STREAM_TIMEOUT,
        });

        const mediaStreamUrl: MediaStreamUrl = {
            url: playbackUrl,
            mediaStreamOptions,
        };
        this.currentMedia = mediaStreamUrl;
        this.currentMediaMimeType = ScryptedMimeTypes.MediaStreamUrl;

        return mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    }

    getSipMediaStreamOptions(): ResponseMediaStreamOptions {
        return {
            id: 'sip',
            name: 'SIP',
            // this stream is NOT scrypted blessed due to wackiness in the h264 stream.
            // tool: "scrypted",
            container: 'sdp',
            audio: {
                // this is a hint to let homekit, et al, know that it's speex audio and needs transcoding.
                codec: 'speex',
            },
            source: 'cloud', // to disable prebuffering
            userConfigurable: false,
        };
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            this.getSipMediaStreamOptions(),
        ]
    }

    async getDevice(nativeId: string) : Promise<BticinoSipLock> {
        return new BticinoSipLock(this)
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }    
}