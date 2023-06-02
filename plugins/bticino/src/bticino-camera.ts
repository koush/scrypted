import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { sleep } from '@scrypted/common/src/sleep';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls } from '@scrypted/common/src/sdp-utils';
import sdk, { BinarySensor, Camera, DeviceProvider, FFmpegInput, HttpRequest, HttpRequestHandler, HttpResponse, Intercom, MediaObject, MediaStreamUrl, PictureOptions, Reboot, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera, VideoClip, VideoClipOptions, VideoClips } from '@scrypted/sdk';
import { SipCallSession } from '../../sip/src/sip-call-session';
import { RtpDescription } from '../../sip/src/rtp-utils';
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
import { SipRequest } from '../../sip/src/sip-manager';

import { get } from 'http'
import { ControllerApi } from './c300x-controller-api';

const STREAM_TIMEOUT = 65000;
const { mediaManager } = sdk;

export class BticinoSipCamera extends ScryptedDeviceBase implements DeviceProvider, Intercom, Camera, VideoCamera, Settings, BinarySensor, HttpRequestHandler, VideoClips, Reboot {

    private session: SipCallSession
    private remoteRtpDescription: RtpDescription
    private audioOutForwarder: dgram.Socket
    private audioOutProcess: ChildProcess
    private currentMedia: FFmpegInput | MediaStreamUrl
    private currentMediaMimeType: string
    private refreshTimeout: NodeJS.Timeout
    public requestHandlers: CompositeSipMessageHandler = new CompositeSipMessageHandler()
    public incomingCallRequest : SipRequest
    private settingsStorage: BticinoStorageSettings = new BticinoStorageSettings( this )
    private voicemailHandler : VoicemailHandler = new VoicemailHandler(this)
    private inviteHandler : InviteHandler = new InviteHandler(this)
    private controllerApi : ControllerApi = new ControllerApi(this)
    //TODO: randomize this
    private keyAndSalt : string = "/qE7OPGKp9hVGALG2KcvKWyFEZfSSvm7bYVDjT8X"
    //private decodedSrtpOptions : SrtpOptions = decodeSrtpOptions( this.keyAndSalt )
    private persistentSipManager : PersistentSipManager
    public doorbellWebhookUrl : string
    public doorbellLockWebhookUrl : string

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
            });               
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
            });                    
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

        const audioOutForwarder = await createBindZero()
        this.audioOutForwarder = audioOutForwarder.server
        audioOutForwarder.server.on('message', message => {
            if( this.session )
                this.session.audioSplitter.send(message, 40004, this.remoteRtpDescription.address)
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

        const playbackUrl = clientUrl

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000)
            let sip: SipCallSession
            try {
                await this.controllerApi.updateStreamEndpoint()
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

                sip = await this.persistentSipManager.session( sipOptions );
                // Validate this sooner
                if( !sip ) return Promise.reject("Cannot create session")
                
                sip.onCallEnded.subscribe(cleanup)

                // Call the C300X
                this.remoteRtpDescription = await sip.callOrAcceptInvite(
                    ( audio ) => {
                    return [
                        //TODO: Payload types are hardcoded
                        `m=audio 65000 RTP/SAVP 110`,
                        `a=rtpmap:110 speex/8000`,
                        `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
                    ]
                }, ( video ) => {
                    if( false ) {
                        //TODO: implement later
                        return [
                            `m=video 0 RTP/SAVP 0`
                        ]
                    } else {
                        return [
                            //TODO: Payload types are hardcoded
                            `m=video 65002 RTP/SAVP 96`,
                            `a=rtpmap:96 H264/90000`,
                            `a=fmtp:96 profile-level-id=42801F`,
                            `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${this.keyAndSalt}`,
                            'a=recvonly'                        
                        ]
                    }
                }, this.incomingCallRequest );

                this.incomingCallRequest = undefined

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
                sdp = addTrackControls(sdp)
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n')
                if( sipOptions.debugSip )
                    this.log.d('SIP: Updated SDP:\n' + sdp);

                client.write(sdp)
                client.end()

                this.session = sip
            }
            catch (e) {
                this.console.error(e)
                sip?.stop()
                throw e;
            }
        });

        this.resetStreamTimeout();

        const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
            refreshAt: Date.now() + STREAM_TIMEOUT,
        });

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            container: 'sdp',
            mediaStreamOptions,
            inputArguments: [
                '-f', 'sdp',
                '-i', playbackUrl,
            ],
        };
        this.currentMedia = ffmpegInput;
        this.currentMediaMimeType = ScryptedMimeTypes.FFmpegInput;

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
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
        this.voicemailHandler.cancelTimer()
        this.persistentSipManager.cancelTimer()        
        this.controllerApi.cancelTimer()
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