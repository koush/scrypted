import { closeQuiet, createBindUdp, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { sleep } from '@scrypted/common/src/sleep';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { BinarySensor, Camera, DeviceProvider, FFmpegInput, HttpRequest, HttpRequestHandler, HttpResponse, Intercom, MediaObject, MediaStreamUrl, MotionSensor, PictureOptions, Reboot, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera, VideoClip, VideoClipOptions, VideoClips } from '@scrypted/sdk';
import { SipCallSession } from '../../sip/src/sip-call-session';
import { RtpDescription, getPayloadType, getSequenceNumber, isRtpMessagePayloadType, isStunMessage } from '../../sip/src/rtp-utils';
import { VoicemailHandler } from './bticino-voicemailHandler';
import { CompositeSipMessageHandler } from '../../sip/src/compositeSipMessageHandler';
import { SipHelper } from './sip-helper';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { BticinoStorageSettings } from './storage-settings';
import { BticinoSipPlugin } from './main';
import { BticinoSipLock } from './bticino-lock';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { PersistentSipManager } from './persistent-sip-manager';
import { InviteHandler } from './bticino-inviteHandler';
import { SipOptions, SipRequest } from '../../sip/src/sip-manager';

import { get } from 'http'
import { ControllerApi } from './c300x-controller-api';
import { BticinoAswmSwitch } from './bticino-aswm-switch';
import { BticinoMuteSwitch } from './bticino-mute-switch';

const STREAM_TIMEOUT = 65000;
const { mediaManager } = sdk;

export class BticinoSipCamera extends ScryptedDeviceBase implements MotionSensor, DeviceProvider, Intercom, Camera, VideoCamera, Settings, BinarySensor, HttpRequestHandler, VideoClips, Reboot {

    private session: SipCallSession
    private remoteRtpDescription: Promise<RtpDescription>
    private audioOutForwarder: dgram.Socket
    private audioOutProcess: ChildProcess
    private refreshTimeout: NodeJS.Timeout
    public requestHandlers: CompositeSipMessageHandler = new CompositeSipMessageHandler()
    public incomingCallRequest : SipRequest
    private settingsStorage: BticinoStorageSettings = new BticinoStorageSettings( this )
    private voicemailHandler : VoicemailHandler = new VoicemailHandler(this)
    private inviteHandler : InviteHandler = new InviteHandler(this)
    private controllerApi : ControllerApi = new ControllerApi(this)
    private muteSwitch : BticinoMuteSwitch
    private aswmSwitch : BticinoAswmSwitch
    private deferredCleanup
    private currentMediaObject : Promise<MediaObject>
    private lastImageRefresh : number
    //TODO: randomize this
    private keyAndSalt : string = "/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X"
    //private decodedSrtpOptions : SrtpOptions = decodeSrtpOptions( this.keyAndSalt )
    private persistentSipManager : PersistentSipManager
    public doorbellWebhookUrl : string
    public doorbellLockWebhookUrl : string
    private cachedImage : Buffer

    constructor(nativeId: string, public provider: BticinoSipPlugin) {
        super(nativeId)
        this.requestHandlers.add( this.voicemailHandler ).add( this.inviteHandler )
        this.persistentSipManager = new PersistentSipManager( this );
        (async() => {
            this.doorbellWebhookUrl = await this.doorbellWebhookEndpoint()
            this.doorbellLockWebhookUrl = await this.doorbellLockWebhookEndpoint()
        })();
    }

    reboot(): Promise<void> {
        return new Promise<void>( (resolve,reject ) => {
            let c300x = SipHelper.getIntercomIp(this)

            get(`http://${c300x}:8080/reboot?now`, (res) => {
                console.log("Reboot API result: " + res.statusCode)
            }).on('error', (error) => {
                this.console.error(error)
                reject(error)
            } ).end();               
        })
    }

    muteRinger(mute : boolean): Promise<void> {
        return new Promise<void>( (resolve,reject ) => {
            let c300x = SipHelper.getIntercomIp(this)

            get(`http://${c300x}:8080/mute?raw=true&enable=` + mute, (res) => {
                console.log("Mute API result: " + res.statusCode)
            }).on('error', (error) => {
                this.console.error(error)
                reject(error)
            } ).end();               
        })
    }    

    muteStatus(): Promise<boolean> {
        return new Promise<boolean>( (resolve,reject ) => {
            let c300x = SipHelper.getIntercomIp(this)

            get(`http://${c300x}:8080/mute?status=true&raw=true`, (res) => {
                let rawData = '';
                res.on('data', (chunk) => { rawData += chunk; })
                res.on('error', (error) =>  this.console.log(error))
                res.on('end', () => {
                try {
                    return  resolve(JSON.parse(rawData))
                } catch (e) {
                    console.error(e.message);
                    reject(e.message)
                    
                }
                })
            }).on('error', (error) => {
                this.console.error(error)
                reject(error)
            } ).end();               
        })
    }      

    getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
       return new Promise<VideoClip[]>(  (resolve,reject ) => {
            let c300x = SipHelper.getIntercomIp(this)
            if( !c300x ) return []
            get(`http://${c300x}:8080/videoclips?raw=true&startTime=${options.startTime/1000}&endTime=${options.endTime/1000}`, (res) => {
                let rawData = '';
                res.on('data', (chunk) => { rawData += chunk; });
                res.on('end', () => {
                try {
                    const parsedData : [] = JSON.parse(rawData);
                    let videoClips : VideoClip[] = []
                    parsedData.forEach( (item) => {
                        let videoClip : VideoClip = {
                            id: item['file'],
                            startTime: parseInt(item['info']['UnixTime']) * 1000,
                            duration: item['info']['Duration'] * 1000,
                            //description: item['info']['Date'],
                            thumbnailId: item['file']

                        }
                        videoClips.push( videoClip )
                    } )
                    return  resolve(videoClips)
                } catch (e) {
                    reject(e.message)
                    console.error(e.message);
                }
                })
            }).on('error', (error) => {
                this.console.error(error)
                reject(error)
            } ).end(); ;                    
        });
    }

    getVideoClip(videoId: string): Promise<MediaObject> {
        let c300x = SipHelper.getIntercomIp(this)
        const url = `http://${c300x}:8080/voicemail?msg=${videoId}/aswm.avi&raw=true`;
        return mediaManager.createMediaObjectFromUrl(url);        
    }
    getVideoClipThumbnail(thumbnailId: string): Promise<MediaObject> {
        let c300x = SipHelper.getIntercomIp(this)
        const url = `http://${c300x}:8080/voicemail?msg=${thumbnailId}/aswm.jpg&raw=true`;
        return mediaManager.createMediaObjectFromUrl(url);        
    }

    removeVideoClips(...videoClipIds: string[]): Promise<void> {
        //TODO
        throw new Error('Method not implemented.')
    }

    sipUnlock(): Promise<void> {
        this.log.i("unlocking C300X door ")
        return this.persistentSipManager.enable().then( (sipCall) => {
            sipCall.message( '*8*19*20##' )
            .then( () =>
                sleep(1000)
                    .then( () => sipCall.message( '*8*20*20##' ) )
            )
        } )
    }

    getAswmStatus() : Promise<void> {
        return this.persistentSipManager.enable().then( (sipCall) => {
            sipCall.message( "GetAswmStatus!" )
        } )        
    }

    turnOnAswm() : Promise<void> {
        return this.persistentSipManager.enable().then( (sipCall) => {
            sipCall.message( "*8*91##" )
        } )        
    }

    turnOffAswm() : Promise<void> {
        return this.persistentSipManager.enable().then( (sipCall) => {
            sipCall.message( "*8*92##" )
        } )        
    }    

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        const thumbnailCacheTime : number = parseInt( this.storage?.getItem('thumbnailCacheTime') ) * 1000 || 300000 
        const now = new Date().getTime()
        if( !this.lastImageRefresh || this.lastImageRefresh + thumbnailCacheTime < now ) {
            // get a proxy object to make sure we pass prebuffer when already watching a stream
            let cam : VideoCamera = sdk.systemManager.getDeviceById<VideoCamera>(this.id)
            let vs : MediaObject = await cam.getVideoStream()
            let buf : Buffer = await mediaManager.convertMediaObjectToBuffer(vs, 'image/jpeg');
            this.cachedImage = buf
            this.lastImageRefresh = new Date().getTime()
            this.console.log(`Camera picture updated and cached: ${this.lastImageRefresh} + cache time: ${thumbnailCacheTime} < ${now}`)

        } else {
            this.console.log(`Not refreshing camera picture: ${this.lastImageRefresh} + cache time: ${thumbnailCacheTime} < ${now}`)
        }
        return mediaManager.createMediaObject(this.cachedImage, 'image/jpeg')
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
        if (!this.session) {
            const cleanup = () => {
                this.console.log("STARTINTERCOM CLEANUP CALLED: " + this.session )
                this.session?.stop()
                this.session = undefined
                this.deferredCleanup()
                this.console.log("STARTINTERCOM CLEANUP ENDED")
            }
            this.session = await this.callIntercom( cleanup )
        }
            

        this.stopIntercom();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const audioOutForwarder = await createBindZero()
        this.audioOutForwarder = audioOutForwarder.server
        let address = (await this.remoteRtpDescription).address
        audioOutForwarder.server.on('message', message => {
            if( this.session )
                this.session.audioSplitter.send(message, 40004, address)
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
            //'-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            //'-srtp_out_params', encodeSrtpOptions(this.decodedSrtpOptions),
            `rtp://127.0.0.1:${audioOutForwarder.port}?pkt_size=188`,
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

    hasActiveCall() {
        return this.session;
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

        this.console.log("Before stopping session")
        this.stopSession();
        this.console.log("After stopping session")

        let rebroadcastEnabled = this.interfaces?.includes( "mixin:@scrypted/prebuffer-mixin")

        const { clientPromise: playbackPromise, port: playbackPort } = await listenZeroSingleClient()

        const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`

        this.console.log("PLAYBACKURL: " +playbackUrl)

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000)

            let sip: SipCallSession
            let audioSplitter
            let videoSplitter
            try {
                if( !this.incomingCallRequest ) {
                    // If this is a "view" call, update the stream endpoint to send it only to "us"
                    // In case of an incoming doorbell event, the C300X is already streaming video to all registered endpoints
                    await this.controllerApi.updateStreamEndpoint()
                }

                let rtsp: RtspServer;

                const cleanup = () => {
                    this.console.log("CLEANUP CALLED")
                    client.destroy();
                    if (this.session === sip)
                        this.session = undefined
                    try {
                        this.log.d('cleanup(): stopping sip session.')
                        sip?.stop()
                        this.currentMediaObject = undefined
                    }
                    catch (e) {
                    }
                    audioSplitter?.server?.close()
                    videoSplitter?.server?.close()
                    rtsp?.destroy()
                    this.console.log("CLEANUP ENDED")
                    this.deferredCleanup = undefined
                    this.remoteRtpDescription = undefined
                }
                this.deferredCleanup = cleanup

                client.on('close', cleanup)
                client.on('error', cleanup)

                if( !rebroadcastEnabled || (rebroadcastEnabled && !this.incomingCallRequest ) ) {
                    sip = await this.callIntercom( cleanup )
                }

                //let sdp: string = replacePorts(this.remoteRtpDescription.sdp, 0, 0 )
                let sdp : string = [
                    "v=0",
                    "m=audio 5000 RTP/AVP 110",
                    "c=IN IP4 127.0.0.1",
                    "a=rtpmap:110 speex/8000/1",
                    "m=video 5002 RTP/AVP 96",
                    "c=IN IP4 127.0.0.1",
                    "a=rtpmap:96 H264/90000",
                ].join('\r\n')
                //sdp = sdp.replaceAll(/a=crypto\:1.*/g, '')
                //sdp = sdp.replaceAll(/RTP\/SAVP/g, 'RTP\/AVP')
                //sdp = sdp.replaceAll('\r\n\r\n', '\r\n')

                let vseq = 0;
                let vseen = 0;
                let vlost = 0;
                let aseq = 0;
                let aseen = 0;
                let alost = 0;

                sdp = addTrackControls(sdp);
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
                this.console.log('proposed sdp', sdp);

                this.console.log("=================  AUDIOSPLITTER CREATING.... ============" )
                audioSplitter = await createBindUdp(5000)
                this.console.log("=================  AUDIOSPLITTER CREATED ============" )
                audioSplitter.server.on('close', () => {
                    this.console.log("================= CLOSED AUDIOSPLITTER ================")
                    audioSplitter = undefined
                })
                this.console.log("=================  VIDEOSPLITTER CREATING.... ============" )
                videoSplitter = await createBindUdp(5002)
                this.console.log("=================  VIDEOSPLITTER CREATED.... ============" )
                videoSplitter.server.on('close', () => {
                    this.console.log("================= CLOSED VIDEOSPLITTER ================")
                    videoSplitter = undefined
                })

                rtsp = new RtspServer(client, sdp, false);

                const parsedSdp = parseSdp(rtsp.sdp);
                const videoTrack = parsedSdp.msections.find(msection => msection.type === 'video').control;
                const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
                rtsp.console = this.console;

                await rtsp.handlePlayback();

                this.session = sip

                videoSplitter.server.on('message', (message, rinfo) => {
                     if ( !isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                return;
                            vseen++;
                            try {
                                rtsp.sendTrack(videoTrack, message, !isRtpMessage);
                            } catch(e ) {
                                this.console.log(e)
                            }

                            const seq = getSequenceNumber(message);
                            if (seq !== (vseq + 1) % 0x0FFFF)
                                vlost++;
                            vseq = seq;
                        }
                });

                audioSplitter.server.on('message', (message, rinfo ) => {
                        if ( !isStunMessage(message)) {
                            const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                            if (!isRtpMessage)
                                return;
                            aseen++;
                            try {
                                rtsp.sendTrack(audioTrack, message, !isRtpMessage);
                            } catch(e) {
                                this.console.log(e)
                            }
                            const seq = getSequenceNumber(message);
                            if (seq !== (aseq + 1) % 0x0FFFF)
                                alost++;
                            aseq = seq;
                        }
                });

                try {
                    await rtsp.handleTeardown();
                    this.console.log('rtsp client ended');
                } catch (e) {
                    this.console.log('rtsp client ended ungracefully', e);
                } finally {
                    cleanup();
                }
            }
            catch (e) {
                this.console.error(e)
                throw e;
            }
        });

        const mediaStreamUrl: MediaStreamUrl = {
            url: playbackUrl,
            mediaStreamOptions: this.getSipMediaStreamOptions(),
        };

        sleep(2500).then( () => this.takePicture() )

        this.currentMediaObject = mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
        // Invalidate any cached image and take a picture after some seconds to take into account the opening of the lens
        this.lastImageRefresh = undefined
        return this.currentMediaObject
    }

    async callIntercom( cleanup ) : Promise<SipCallSession> {
        let sipOptions : SipOptions = SipHelper.sipOptions( this )

        let sip : SipCallSession = await this.persistentSipManager.session( sipOptions );
        // Validate this sooner
        if( !sip ) return Promise.reject("Cannot create session")

        sip.onCallEnded.subscribe(cleanup)

        // Call the C300X
        this.remoteRtpDescription = sip.callOrAcceptInvite(
            ( audio ) => {
            return [
                // this SDP is used by the intercom and will send the encrypted packets which we don't care about to the loopback on port 65000 of the intercom
                `m=audio 65000 RTP/SAVP 110`,
                `a=rtpmap:110 speex/8000`,
                `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
            ]
        }, ( video ) => {
                return [
                // this SDP is used by the intercom and will send the encrypted packets which we don't care about to the loopback on port 65000 of the intercom
                `m=video 65002 RTP/SAVP 96`,
                `a=rtpmap:96 H264/90000`,
                `a=fmtp:96 profile-level-id=42801F`,
                `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
                'a=recvonly'
                ]
        }, this.incomingCallRequest );

        this.incomingCallRequest = undefined

        return sip
    }

    getSipMediaStreamOptions(): ResponseMediaStreamOptions {
        return {
            id: 'sip',
            name: 'SIP',
            // this stream is NOT scrypted blessed due to wackiness in the h264 stream.
            // tool: "scrypted",
            container: 'rtsp',
            video: {
                codec: 'h264'
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's speex audio and needs transcoding.
                codec: 'speex',
            },
            source: 'cloud', // to disable prebuffering
            userConfigurable: true,
        };
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            this.getSipMediaStreamOptions(),
        ]
    }

    async getDevice(nativeId: string) : Promise<any> {
        if( nativeId && nativeId.endsWith('-aswm-switch')) {
            this.aswmSwitch = new BticinoAswmSwitch(this, this.voicemailHandler)
            return this.aswmSwitch
        } else if( nativeId && nativeId.endsWith('-mute-switch') ) {
            this.muteSwitch = new BticinoMuteSwitch(this)
            return this.muteSwitch
        }
        return new BticinoSipLock(this)
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        if( nativeId?.endsWith('-aswm-switch') ) {
            this.aswmSwitch.cancelTimer()
        } else if( nativeId?.endsWith('mute-switch') ) {
            this.muteSwitch.cancelTimer()
        } else {
            this.stopIntercom()
            this.voicemailHandler.cancelTimer()
            this.persistentSipManager.cancelTimer()        
            this.controllerApi.cancelTimer()
        }
    }    

    reset() {
        this.console.log("Reset the incoming call request")
        this.incomingCallRequest = undefined
        this.binaryState = false
    }    

    public async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.url.endsWith('/pressed')) {
            this.binaryState = true
            setTimeout( () => {
                // Assumption that flexisip only holds this call active for 20 seconds ... might be revised
                this.reset()
            }, 20 * 1000 )            
            response.send('Success', {
                code: 200,
            });
        } else {
            response.send('Unsupported operation', {
                code: 400,
            });
        }
    }        

    private async doorbellWebhookEndpoint(): Promise<string> {
        let webhookUrl = await sdk.endpointManager.getLocalEndpoint( this.nativeId, { insecure: false, public: true });
        let endpoints = ["/pressed"]
        this.console.log( webhookUrl + " , endpoints: " + endpoints.join(' - ') )
        return `${webhookUrl}`;
    }

    private async doorbellLockWebhookEndpoint(): Promise<string> {
        let webhookUrl = await sdk.endpointManager.getLocalEndpoint(this.nativeId + '-lock', { insecure: false, public: true });
        let endpoints = ["/lock", "/unlock", "/unlocked", "/locked"]
        this.console.log( webhookUrl + " -> endpoints: " + endpoints.join(' - ') )
        return `${webhookUrl}`;
    }  
}