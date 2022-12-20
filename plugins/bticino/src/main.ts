import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { SipCall, SipOptions } from '../../sip/src/sip-call';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import dgram from 'dgram';
import { SipSession } from '../../sip/src/sip-session';
import { isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from '../../sip/src/rtp-utils';
import { ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';

const STREAM_TIMEOUT = 50000;
const SIP_EXPIRATION_DEFAULT = 3600;
const { deviceManager, mediaManager } = sdk;

class SipCamera extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, Settings, BinarySensor {
    session: SipSession;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    doorbellAudioActive: boolean;
    audioInProcess: ChildProcess;
    currentMedia: FFmpegInput | MediaStreamUrl;
    currentMediaMimeType: string;
    audioSilenceProcess: ChildProcess;
    refreshTimeout: NodeJS.Timeout;
    pendingPicture: Promise<MediaObject>;

    constructor(nativeId: string, public provider: SipCamProvider) {
        super(nativeId);
        this.binaryState = false;
        this.doorbellAudioActive = false;
        this.audioSilenceProcess = null;
    }

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The SIP doorbell camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    settingsStorage = new StorageSettings(this, {
        sipfrom: {
            title: 'SIP From: URI',
            type: 'string',
            value: this.storage.getItem('sipfrom'),
            description: 'SIP URI From field: Using the IP address of your server you will be calling from. Also the user and IP you added in /etc/flexisip/users/route_ext.conf on the intercom.',
            placeholder: 'user@192.168.0.111',
            multiple: false,
        },
        sipto: {
            title: 'SIP To: URI',
            type: 'string',
            description: 'SIP URI To field: Must look like c300x@IP;transport=udp;rport and UDP transport is the only one supported right now.',
            placeholder: 'c300x@192.168.0.2[:5060];transport=udp;rport',
        },
        sipdomain: {
            title: 'SIP domain',
            type: 'string',
            description: 'SIP domain: The internal BTicino domain, usually has the following format: 2048362.bs.iotleg.com',
            placeholder: '2048362.bs.iotleg.com',
        },
        sipexpiration: {
            title: 'SIP UA expiration',
            type: 'number',
            range: [60, SIP_EXPIRATION_DEFAULT],
            description: 'SIP UA expiration: How long the UA should remain active before expiring. Use 3600.',
            placeholder: '3600',
        },
        sipdebug: {
            title: 'SIP debug logging',
            type: 'boolean',
            description: 'Enable SIP debugging',
            placeholder: 'true or false',
        },
    });

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
 
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }    

    async startIntercom(media: MediaObject): Promise<void> {
        this.log.d( "TODO: startIntercom" + media );
    }

    async stopIntercom(): Promise<void> {
        this.log.d( "TODO: stopIntercom" );
    }

    resetStreamTimeout() {
        this.log.d('starting/refreshing stream');
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => this.stopSession(), STREAM_TIMEOUT);
    }

    stopSession() {
        this.doorbellAudioActive = false;
        this.audioInProcess?.kill('SIGKILL');
        if (this.session) {
            this.log.d('ending sip session');
            this.session.stop();
            this.session = undefined;
        }
    }

    async getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
        if (options?.metadata?.refreshAt) {
            if (!this.currentMedia?.mediaStreamOptions)
                throw new Error("no stream to refresh");

            const currentMedia = this.currentMedia;
            currentMedia.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
            currentMedia.mediaStreamOptions.metadata = {
                refreshAt: currentMedia.mediaStreamOptions.refreshAt
            };
            this.resetStreamTimeout();
            return mediaManager.createMediaObject(currentMedia, this.currentMediaMimeType);
        }

        this.stopSession();


        const { clientPromise: playbackPromise, port: playbackPort, url: clientUrl } = await listenZeroSingleClient();

        const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`;

        playbackPromise.then(async (client) => {
            client.setKeepAlive(true, 10000);
            let sip: SipSession;
            try {
                let rtsp: RtspServer;
                const cleanup = () => {
                    client.destroy();
                    if (this.session === sip)
                        this.session = undefined;
                    try {
                        this.log.d('cleanup(): stopping sip session.');
                        sip.stop();
                    }
                    catch (e) {
                    }
                    rtsp?.destroy();
                }

                client.on('close', cleanup);
                client.on('error', cleanup);

                const from = this.storage.getItem('sipfrom')?.trim();
                const to = this.storage.getItem('sipto')?.trim();
                const localIp = from?.split(':')[0].split('@')[1];
                const localPort = parseInt(from?.split(':')[1]) || 5060;
                const domain = this.storage.getItem('sipdomain')?.trim();
                const expiration : string = this.storage.getItem('sipuaexpiration')?.trim() || '3600';
                const sipdebug : boolean = this.storage.getItem('sipdebug')?.toLocaleLowerCase() === 'true' || false;

                if (!from || !to || !localIp || !localPort || !domain || !expiration ) {
                    this.log.e('Error: SIP From/To/Domain URIs not specified!');
                    return;
                }        

                //TODO settings
                let sipOptions : SipOptions = { 
                    from: "sip:" + from,
                    to: "sip:" + to, 
                    domain: domain,
                    expire: Number.parseInt( expiration ),
                    localIp,
                    localPort,
                    shouldRegister: true,
                    debugSip: sipdebug
                 };
                sip = await SipSession.createSipSession(console, "Bticino", sipOptions);
                
                sip.onCallEnded.subscribe(cleanup);

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
                if( sipOptions.debugSip )
                    this.log.d('SIP: Received remote SDP:\n' + remoteRtpDescription.sdp)

                let sdp: string = replacePorts( remoteRtpDescription.sdp, 0, 0 );
                sdp = addTrackControls(sdp);
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
                if( sipOptions.debugSip )
                    this.log.d('SIP: Updated SDP:\n' + sdp);

                let vseq = 0;
                let vseen = 0;
                let vlost = 0;
                let aseq = 0;
                let aseen = 0;
                let alost = 0;  

                rtsp = new RtspServer(client, sdp, true);
                const parsedSdp = parseSdp(rtsp.sdp);
                const videoTrack = parsedSdp.msections.find(msection => msection.type === 'video').control;
                const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
                if( sipOptions.debugSip ) {
                    rtsp.console = this.console;
                }
                
                await rtsp.handlePlayback();
                sip.videoSplitter.on('message', message => {
                    if (!isStunMessage(message)) {
                        const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                        if (!isRtpMessage)
                            return;
                        vseen++;
                        rtsp.sendTrack(videoTrack, message, !isRtpMessage);
                        const seq = getSequenceNumber(message);
                        if (seq !== (vseq + 1) % 0x0FFFF)
                            vlost++;
                        vseq = seq;
                    }
                });

                sip.videoRtcpSplitter.on('message', message => {
                    rtsp.sendTrack(videoTrack, message, true);
                });
                
                sip.audioSplitter.on('message', message => {
                    if (!isStunMessage(message)) {
                        const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                        if (!isRtpMessage)
                            return;
                        aseen++;
                        rtsp.sendTrack(audioTrack, message, !isRtpMessage);
                        const seq = getSequenceNumber(message);
                        if (seq !== (aseq + 1) % 0x0FFFF)
                            alost++;
                        aseq = seq;
                    }
                });

                sip.audioRtcpSplitter.on('message', message => {
                    rtsp.sendTrack(audioTrack, message, true);
                });

                this.session = sip;

                try {
                    await rtsp.handleTeardown();
                    this.log.d('rtsp client ended');
                }
                catch (e) {
                    this.log.e('rtsp client ended ungracefully' + e);
                }
                finally {
                    cleanup();
                }
            }
            catch (e) {
                sip?.stop();
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
            source: 'local',
            userConfigurable: false,
        };
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            this.getSipMediaStreamOptions(),
        ]
    }
}

export class SipCamProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }
    }

    async releaseDevice(id: string, nativeId: string, device: any): Promise<void> {
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = randomBytes(4).toString('hex');
        const name = settings.newCamera.toString();
        await this.updateDevice(nativeId, name);
        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'newCamera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    updateDevice(nativeId: string, name: string) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                ScryptedInterface.BinarySensor
            ],
            type: ScryptedDeviceType.Doorbell,
        });
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    createCamera(nativeId: string): SipCamera {
        return new SipCamera(nativeId, this);
    }
}

export default new SipCamProvider();
