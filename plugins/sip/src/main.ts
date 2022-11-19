import { closeQuiet, createBindZero, listenZeroSingleClient, listenZero } from '@scrypted/common/src/listen-cluster';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, MotionSensor, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import net from 'net';
import { SipSession } from './sip-session';
import { SipOptions } from './sip-call';
import { RtpDescription, isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './rtp-utils';
import { v4 as generateRandomUuid } from 'uuid';

const STREAM_TIMEOUT = 120000;
const { deviceManager, mediaManager, systemManager } = sdk;

class SipCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, MotionSensor, BinarySensor {
    buttonTimeout: NodeJS.Timeout;
    session: SipSession;
    rtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    currentMedia: FFmpegInput | MediaStreamUrl;
    currentMediaMimeType: string;
    refreshTimeout: NodeJS.Timeout;
    sipSdpPromise: Promise<string>;
    currentProcess: ChildProcess;

    constructor(public plugin: SipPlugin, nativeId: string) {
        super(nativeId);
        this.motionDetected = false;
        this.binaryState = false;
        this.console.log('SipCameraDevice ctor()');

        //this.sipSdpPromise = this.testCall();
    }

    async startIntercom(media: MediaObject): Promise<void> {

        await this.callDoorbell();

        if (!this.session)
            throw new Error("not in call");

        this.stopAudioOut();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ringRtpOptions = this.rtpDescription;
        const audioOutForwarder = await createBindZero();
        this.audioOutForwarder = audioOutForwarder.server;
        audioOutForwarder.server.on('message', message => {
            this.session.audioSplitter.send(message, ringRtpOptions.audio.port, ringRtpOptions.address);
            return null;
        });


        const args = ffmpegInput.inputArguments.slice();
        args.push(
            '-vn', '-dn', '-sn',
            '-acodec', 'pcm_mulaw',
            '-flags', '+global_header',
            '-ac', '1',
            '-ar', '8k',
            '-f', 'rtp',
            `rtp://127.0.0.1:${audioOutForwarder.port}?pkt_size=188`,
        );

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
        this.audioOutProcess = cp;
        cp.on('exit', () => this.console.log('two way audio ended'));
        this.session.onCallEnded.subscribe(() => {
            closeQuiet(audioOutForwarder.server);
            cp.kill('SIGKILL');
        });
    }

    async stopIntercom(): Promise<void> {
        this.stopAudioOut();
        this.stopSession();
    }

    async stopAudioOut(): Promise<void> {
        closeQuiet(this.audioOutForwarder);
        this.audioOutProcess?.kill('SIGKILL');
        this.audioOutProcess = undefined;
        this.audioOutForwarder = undefined;
    }

    resetStreamTimeout() {
        this.console.log('starting/refreshing stream');
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => this.stopSession(), STREAM_TIMEOUT);
    }

    stopSession() {
        if (this.session) {
            this.console.log('ending sip session');
            this.session.stop();
            this.session = undefined;
        }
    }

    async callDoorbell(): Promise<void> {
        let sip: SipSession;

        this.console.log('calling doorbell');

        const cleanup = () => {
            if (this.session === sip)
                this.session = undefined;
            try {
                this.console.log('stopping sip session.');
                sip.stop();
            }
            catch (e) {
            }
        }

        let sipOptions: SipOptions = { from: "sip:user1@10.10.10.70", to: "sip:11@10.10.10.22", localIp: "10.10.10.70", localPort: 5060 };
        //let sipOptions: SipOptions = { from: "sip:user1@10.10.10.70", to: "sip:11@10.10.10.80", localIp: "10.10.10.70", localPort: 5060 };

        sip = await SipSession.createSipSession(this.console, this.name, sipOptions);
        sip.onCallEnded.subscribe(cleanup);
        this.rtpDescription = await sip.start();
        this.console.log('sip remote sdp', this.rtpDescription.sdp)

        let aseq = 0;
        let aseen = 0;
        let alost = 0;

        sip.audioSplitter.on('message', message => {
                if (!isStunMessage(message)) {
                    const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                    if (!isRtpMessage)
                        return;
                    aseen++;
                    sip.audioSplitter.send(message, 5004, "127.0.0.1");
                    const seq = getSequenceNumber(message);
                    if (seq !== (aseq + 1) % 0x0FFFF)
                        alost++;
                    aseq = seq;
                }
            });

            sip.audioRtcpSplitter.on('message', message => {
                //sip.audioRtcpSplitter.send(message, 5005, "127.0.0.1");
            });

            this.session = sip;
    }

    // async testCall(): Promise<string> {
    //     let sip: SipSession;

    //     this.console.log('starting testcall sip session.');

    //     const cleanup = () => {
    //         if (this.session === sip)
    //             this.session = undefined;
    //         try {
    //             this.console.log('stopping sip session.');
    //             sip.stop();
    //         }
    //         catch (e) {
    //         }
    //     }

    //     let sipOptions: SipOptions = { from: "sip:user1@10.10.10.70", to: "sip:11@10.10.10.22", localIp: "10.10.10.70", localPort: 5060 };

    //     sip = await SipSession.createSipSession(this.console, this.name, sipOptions);
    //     sip.onCallEnded.subscribe(cleanup);
    //     this.rtpDescription = await sip.start();
    //     this.console.log('sip sdp', this.rtpDescription.sdp)

    //     const audioPort = 0

    //     let sdp = replacePorts(this.rtpDescription.sdp, audioPort, 0);
    //     sdp = addTrackControls(sdp);
    //     sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
    //     this.console.log('proposed sdp', sdp);

    //     sip.stop();

    //     this.console.log('stopped testcall sip session.');

    //     return sdp;        
    // }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

        const args=[
            'audiomixer', 'name=amix',
            'udpsrc', 'port=5004', 'caps=application/x-rtp', '!',
            'rtppcmudepay',  '!', 'mulawdec', '!', 'queue' ,'!', 'amix.',
            'audiotestsrc', 'wave=silence', '!', 'queue', '!', 'amix.',
            'amix.', '!', 'audio/x-raw,format=(string)S16LE,layout=(string)interleaved,rate=(int)8000,channels=(int)1', '!', 'opusenc'
        ];

        const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
            // refreshAt: Date.now() + STREAM_TIMEOUT,
        });

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);
            server.close();

            const gstreamerServer = net.createServer(gstreamerSocket => {
                clearTimeout(gstreamerTimeout);
                gstreamerServer.close();
                clientSocket.pipe(gstreamerSocket).pipe(clientSocket);
            });
            const gstreamerTimeout = setTimeout(() => {
                this.console.log('timed out waiting for gstreamer');
                gstreamerServer.close();
            }, 30000);
            const gstreamerPort = await listenZero(gstreamerServer);
            args.push('!', 'mpegtsmux', '!', 'tcpclientsink', `port=${gstreamerPort}`, 'sync=false');
            this.console.log(args.join(' '));
            if (this.currentProcess) {
                this.currentProcess.kill();
                this.currentProcess = undefined;
            }
            const cp = child_process.spawn('gst-launch-1.0', args,  { env: { GST_DEBUG: '3' } });
            this.currentProcess = cp;

            cp.stdout.on('data', data => this.console.log(data.toString()));
            cp.stderr.on('data', data => this.console.log(data.toString()));

            clientSocket.on('close', () => cp.kill());
        });
        const serverTimeout = setTimeout(() => {
            this.console.log('timed out waiting for client');
            server.close();
        }, 30000);
        const port = await listenZero(server);

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            mediaStreamOptions,
            inputArguments: [
                '-f', 'rtsp',
                '-i', 'rtsp://10.10.10.10:8554/hauseingang',
                '-f', 'mpegts',
                '-i', `tcp://127.0.0.1:${port}`
            ],
        };
        this.currentMedia = ffmpegInput;
        this.currentMediaMimeType = ScryptedMimeTypes.FFmpegInput;

        return mediaManager.createFFmpegMediaObject(ffmpegInput);

    }

    // gst-launch-1.0 audiomixer name=amix udpsrc port=rx_port caps=application/x-rtp ! rtppcmudepay ! mulawdec ! queue ! amix. audiotestsrc wave=sine ! queue ! amix. amix. ! mulawenc ! rtppcmupay ! udpsink host="127.0.0.1" port=tx_port
    // async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

    //     const { clientPromise: playbackPromise, port: playbackPort } = await listenZeroSingleClient();

    //     const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`;
        
    //     this.console.log(`getVideoStream() ${playbackUrl}`);

    //     playbackPromise.then(async (client) => {
    //         client.setKeepAlive(true, 10000);
    //         try {
    //             let rtsp: RtspServer;
    //             const cleanup = () => {
    //                 client.destroy();
    //                 rtsp?.destroy();
    //             }

    //             client.on('close', cleanup);
    //             client.on('error', cleanup);

    //             let sdp = await this.sipSdpPromise;

    //             this.console.log('using sdp from test call', sdp);

    //             let aseq = 0;
    //             let aseen = 0;
    //             let alost = 0;

    //             rtsp = new RtspServer(client, sdp, true);
    //             const parsedSdp = parseSdp(rtsp.sdp);
    //             const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
    //             rtsp.console = this.console;

    //             await rtsp.handlePlayback();

    //             // sip.audioSplitter.on('message', message => {
    //             //     if (!isStunMessage(message)) {
    //             //         const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
    //             //         if (!isRtpMessage)
    //             //             return;
    //             //         aseen++;
    //             //         rtsp.sendTrack(audioTrack, message, !isRtpMessage);
    //             //         const seq = getSequenceNumber(message);
    //             //         if (seq !== (aseq + 1) % 0x0FFFF)
    //             //             alost++;
    //             //         aseq = seq;
    //             //     }
    //             // });

    //             // sip.audioRtcpSplitter.on('message', message => {
    //             //     rtsp.sendTrack(audioTrack, message, true);
    //             // });

    //             // this.session = sip;

    //             try {
    //                 await rtsp.handleTeardown();
    //                 this.console.log('rtsp client ended');
    //             }
    //             catch (e) {
    //                 this.console.log('rtsp client ended ungracefully', e);
    //             }
    //             finally {
    //                 cleanup();
    //             }
    //         }
    //         catch (e) {
    //             // sip?.stop();
    //             throw e;
    //         }
    //     });

    //     // this.resetStreamTimeout();

    //     const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
    //         // refreshAt: Date.now() + STREAM_TIMEOUT,
    //     });

    //     // if (useRtsp) {
    //     //     const mediaStreamUrl: MediaStreamUrl = {
    //     //         url: playbackUrl,
    //     //         mediaStreamOptions,
    //     //     };
    //     //     this.currentMedia = mediaStreamUrl;
    //     //     this.currentMediaMimeType = ScryptedMimeTypes.MediaStreamUrl;

    //     //     return mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    //     // }

    //     const ffmpegInput: FFmpegInput = {
    //         url: undefined,
    //         mediaStreamOptions,
    //         inputArguments: [
    //             '-f', 'rtsp',
    //             '-i', 'rtsp://10.10.10.10:8554/hauseingang',
    //             '-f', 'rtsp',
    //             '-i', playbackUrl,
    //             //'-f',  'lavfi',
    //             //'-i', 'anullsrc=channel_layout=mono:sample_rate=8000'
    //         ],
    //     };
    //     this.currentMedia = ffmpegInput;
    //     this.currentMediaMimeType = ScryptedMimeTypes.FFmpegInput;

    //     return mediaManager.createFFmpegMediaObject(ffmpegInput);
    // }

    // async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

    //     if (options?.metadata?.refreshAt) {
    //         if (!this.currentMedia?.mediaStreamOptions)
    //             throw new Error("no stream to refresh");

    //         const currentMedia = this.currentMedia;
    //         currentMedia.mediaStreamOptions.refreshAt = Date.now() + STREAM_TIMEOUT;
    //         currentMedia.mediaStreamOptions.metadata = {
    //             refreshAt: currentMedia.mediaStreamOptions.refreshAt
    //         };
    //         this.resetStreamTimeout();
    //         return mediaManager.createMediaObject(currentMedia, this.currentMediaMimeType);
    //     }

    //     this.stopSession();

    //     this.console.log('SipCameraDevice getVideoStream()');

    //     const { clientPromise: playbackPromise, port: playbackPort } = await listenZeroSingleClient();

    //     const playbackUrl = `rtsp://127.0.0.1:${playbackPort}`;
        
    //     this.console.log(`getVideoStream() ${playbackUrl}`);

    //     playbackPromise.then(async (client) => {
    //         client.setKeepAlive(true, 10000);
    //         let sip: SipSession;
    //         try {
    //             let rtsp: RtspServer;
    //             const cleanup = () => {
    //                 client.destroy();
    //                 if (this.session === sip)
    //                     this.session = undefined;
    //                 try {
    //                     this.console.log('stopping sip session.');
    //                     sip.stop();
    //                 }
    //                 catch (e) {
    //                 }
    //                 rtsp?.destroy();
    //             }

    //             client.on('close', cleanup);
    //             client.on('error', cleanup);

    //             let sipOptions: SipOptions = { from: "sip:user1@10.10.10.70", to: "sip:11@10.10.10.22", localIp: "10.10.10.70", localPort: 5060 };

    //             sip = await SipSession.createSipSession(this.console, this.name, sipOptions);
    //             sip.onCallEnded.subscribe(cleanup);
    //             this.console.log(`SipCameraDevice before start()`);
    //             this.rtpDescription = await sip.start();
    //             this.console.log('sip sdp', this.rtpDescription.sdp)

    //             const audioPort = 0

    //             let sdp = replacePorts(this.rtpDescription.sdp, audioPort, 0);
    //             sdp = addTrackControls(sdp);
    //             sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
    //             this.console.log('proposed sdp', sdp);

    //             let aseq = 0;
    //             let aseen = 0;
    //             let alost = 0;

    //             rtsp = new RtspServer(client, sdp, true);
    //             const parsedSdp = parseSdp(rtsp.sdp);
    //             const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
    //             rtsp.console = this.console;

    //             await rtsp.handlePlayback();

    //             sip.audioSplitter.on('message', message => {
    //                 if (!isStunMessage(message)) {
    //                     const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
    //                     if (!isRtpMessage)
    //                         return;
    //                     aseen++;
    //                     rtsp.sendTrack(audioTrack, message, !isRtpMessage);
    //                     const seq = getSequenceNumber(message);
    //                     if (seq !== (aseq + 1) % 0x0FFFF)
    //                         alost++;
    //                     aseq = seq;
    //                 }
    //             });

    //             sip.audioRtcpSplitter.on('message', message => {
    //                 rtsp.sendTrack(audioTrack, message, true);
    //             });

    //             this.session = sip;

    //             try {
    //                 await rtsp.handleTeardown();
    //                 this.console.log('rtsp client ended');
    //             }
    //             catch (e) {
    //                 this.console.log('rtsp client ended ungracefully', e);
    //             }
    //             finally {
    //                 cleanup();
    //             }
    //         }
    //         catch (e) {
    //             sip?.stop();
    //             throw e;
    //         }
    //     });

    //     this.resetStreamTimeout();

    //     const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
    //         refreshAt: Date.now() + STREAM_TIMEOUT,
    //     });

    //     // if (useRtsp) {
    //     //     const mediaStreamUrl: MediaStreamUrl = {
    //     //         url: playbackUrl,
    //     //         mediaStreamOptions,
    //     //     };
    //     //     this.currentMedia = mediaStreamUrl;
    //     //     this.currentMediaMimeType = ScryptedMimeTypes.MediaStreamUrl;

    //     //     return mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    //     // }

    //     const ffmpegInput: FFmpegInput = {
    //         url: undefined,
    //         mediaStreamOptions,
    //         inputArguments: [
    //             '-f', 'rtsp',
    //             '-i', 'rtsp://10.10.10.10:8554/hauseingang',
    //             '-f', 'rtsp',
    //             '-i', playbackUrl,
    //         ],
    //     };
    //     this.currentMedia = ffmpegInput;
    //     this.currentMediaMimeType = ScryptedMimeTypes.FFmpegInput;

    //     return mediaManager.createFFmpegMediaObject(ffmpegInput);
    // }

    getSipMediaStreamOptions(): ResponseMediaStreamOptions {

        return {
            id: 'sip',
            name: 'SIP',
            // this stream is NOT scrypted blessed due to wackiness in the h264 stream.
            // tool: "scrypted",
            container: '', // must be empty to support prebuffering
            video: {
                codec: 'h264',
                // h264Info: {
                //     sei: true,
                //     stapb: true,
                //     mtap16: true,
                //     mtap32: true,
                //     fuab: true,
                //     reserved0: true,
                //     reserved30: true,
                //     reserved31: true,
                // }
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's PCM audio and needs transcoding.
                codec: 'pcm_mulaw',
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

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        // if this stream is prebuffered, its safe to use the prebuffer to generate an image
        const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
        try {
            if (realDevice.interfaces.includes(ScryptedInterface.VideoCamera)) {
                const msos = await realDevice.getVideoStreamOptions();
                const prebuffered: RequestMediaStreamOptions = msos.find(mso => mso.prebuffer);
                if (prebuffered) {
                    prebuffered.refresh = false;
                    return realDevice.getVideoStream(prebuffered);
                }
            }
        }
        catch (e) {
        }

        let buffer: Buffer;

        // try {
        //     buffer = await this.plugin.api.restClient.request({
        //         url: `https://app-snaps.ring.com/snapshots/next/${camera.id}`,
        //         responseType: 'buffer',
        //         searchParams: {
        //             extras: 'force',
        //         },
        //         headers: {
        //             accept: 'image/jpeg',
        //         },
        //         allowNoResponse: true,
        //     });
        // }
        // catch (e) {
        //     this.console.error('snapshot failed, falling back to cache');
        // }

        // if (!buffer) {
        //     buffer = await this.plugin.api.restClient.request({
        //         url: clientApi(`snapshots/image/${camera.id}`),
        //         responseType: 'buffer',
        //         allowNoResponse: true,
        //     });
        // }

        return mediaManager.createMediaObject(buffer, 'image/jpeg');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    triggerBinaryState() {
        this.binaryState = true;
        clearTimeout(this.buttonTimeout);
        this.buttonTimeout = setTimeout(() => this.binaryState = false, 10000);
    }

    findCamera() {
        return null
    }
}

class SipPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {

    devices = new Map<string, SipCameraDevice>();

    settingsStorage = new StorageSettings(this, {
        systemId: {
            title: 'System ID',
            description: 'Used to provide client uniqueness for retrieving the latest set of events.',
            hide: true,
        },
        email: {
            title: 'Email'
        },
        password: {
            title: 'Password',
            type: 'password'
        },
        cameraDingsPollingSeconds: {
            title: 'Poll Interval',
            type: 'number',
            description: 'Optional: Change the default polling interval for motion and doorbell events.',
            defaultValue: 5,
        },
    });

    constructor() {
        super();
        this.discoverDevices(0)
            .catch(e => this.console.error('discovery failure', e));

        if (!this.settingsStorage.values.systemId)
            this.settingsStorage.values.systemId = generateRandomUuid();
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices(duration: number) {
        this.console.log('discover devices');

        const devices: Device[] = [];

        const interfaces = [
            ScryptedInterface.Intercom,
            ScryptedInterface.Camera,
            ScryptedInterface.VideoCamera,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.BinarySensor,
        ];

        const device: Device = {
            info: {
                model: 'SIP Cam',
                manufacturer: 'Sample Camera Manufacturer',
                firmware: "Firmware",
                serialNumber: "SerialNumber"
    },
            nativeId: "SIPCam001",
            name: "SIPCamName",
            type: ScryptedDeviceType.Doorbell,
            interfaces,
        };

        devices.push(device);

        // camera.onDoorbellPressed?.subscribe(async e => {
        //     this.console.log(camera.name, 'onDoorbellPressed', e);
        //     const locationDevice = this.devices.get(location.id);
        //     const scryptedDevice = locationDevice?.devices.get(nativeId);
        //     scryptedDevice?.triggerBinaryState();
        // });
        // camera.onMotionDetected?.subscribe((motionDetected) => {
        //     this.console.log(camera.name, 'onMotionDetected');
        //     const scryptedDevice = this.devices.get(nativeId);
        //     if (scryptedDevice)
        //         scryptedDevice.motionDetected = motionDetected;
        // });

        await deviceManager.onDevicesChanged({
            devices: devices
        });

    }

    async getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const camera = new SipCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }
}

export default new SipPlugin();
