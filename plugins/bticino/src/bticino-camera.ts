import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import { BinarySensor, Camera, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, PictureOptions, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { SipSession } from '../../sip/src/sip-session';
import { isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from '../../sip/src/rtp-utils';
import { VoicemailHandler } from './bticino-voicemailHandler';
import { CompositeSipMessageHandler } from '../../sip/src/compositeSipMessageHandler';
import { sleep } from '@scrypted/common/src/sleep';
import { SipHelper } from './sip-helper';
import { BticinoStorageSettings } from './storage-settings';
import mediaManager, { BticinoSipPlugin } from './main';
import { BticinoSipLock } from './bticino-lock';

const STREAM_TIMEOUT = 50000;

export class BticinoSipCamera extends ScryptedDeviceBase implements DeviceProvider, Intercom, Camera, VideoCamera, Settings, BinarySensor {
    private session: SipSession
    private currentMedia: FFmpegInput | MediaStreamUrl
    private currentMediaMimeType: string
    private refreshTimeout: NodeJS.Timeout
    public messageHandler: CompositeSipMessageHandler
    private settingsStorage: BticinoStorageSettings = new BticinoStorageSettings( this )
    public voicemailHandler : VoicemailHandler = new VoicemailHandler(this)

    constructor(nativeId: string, public provider: BticinoSipPlugin) {
        super(nativeId)
        this.messageHandler = new CompositeSipMessageHandler()
        this.messageHandler.add( this.voicemailHandler )
    }

    sipUnlock(): Promise<void> {
        this.log.i("unlocking C300X door ")
        return SipHelper.sipSession( SipHelper.sipOptions( this ) )
            .then( ( sip ) => {
                sip.sipCall.register()
                    .then( () =>
                        sip.sipCall.message( '*8*19*20##' )
                            .then( () =>
                                sleep(1000)
                                    .then( () => sip.sipCall.message( '*8*20*20##' ) )
                            )
                        .catch( () => {} )
                        .finally( () => sip.sipCall.destroy() )
                    )
                    .catch( e => this.console.error() )
            } )
            .catch(  e => this.console.error(e) )
    }

    getAswmStatus() : Promise<void> {
        return SipHelper.sipSession( SipHelper.sipOptions( this ) )
                .then( ( sip ) => {
                    sip.sipCall.register()
                                    .then( () => sip.sipCall.message( "GetAswmStatus!") )
                                    .catch( () => {})
                                    .finally( () => sip.sipCall.destroy() )
                        } )
                .catch(  e => this.console.error(e) )
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
        this.log.d( "TODO: startIntercom" + media )
    }

    async stopIntercom(): Promise<void> {
        this.log.d( "TODO: stopIntercom" )
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
            let sip: SipSession
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
                let remoteRtpDescription = await sip.call(
                    ( audio ) => {
                    return [
                        'a=DEVADDR:20', // Needed for bt_answering_machine (bticino specific)
                        `m=audio ${audio.port} RTP/SAVP 97`,
                        `a=rtpmap:97 speex/8000`,
                        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X`,
                    ]
                }, ( video ) => {
                    return [
                        `m=video ${video.port} RTP/SAVP 97`,
                        `a=rtpmap:97 H264/90000`,
                        `a=fmtp:97 profile-level-id=42801F`,
                        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X`,
                        'a=recvonly'                        
                    ]
                } );
                if( sip.sipOptions.debugSip )
                    this.log.d('SIP: Received remote SDP:\n' + remoteRtpDescription.sdp)

                let sdp: string = replacePorts( remoteRtpDescription.sdp, 0, 0 )
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