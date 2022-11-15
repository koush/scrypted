import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { RefreshPromise } from "@scrypted/common/src/promise-utils";
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, Device, DeviceDiscovery, DeviceManager, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, MotionSensor, OnOff, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { RtcpReceiverInfo, RtcpRrPacket } from '../../../external/werift/packages/rtp/src/rtcp/rr';
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../external/werift/packages/rtp/src/srtp/srtcp';
import { isStunMessage, RtpDescription, SipSession, clientApi, generateUuid } from './ring-client-api';
import { encodeSrtpOptions, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './srtp-utils';

const STREAM_TIMEOUT = 120000;
const { deviceManager, mediaManager, systemManager } = sdk;

class RingCameraLight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: RingCameraDevice) {
        super(camera.nativeId + '-light');
    }
    async turnOff(): Promise<void> {
        //await this.camera.findCamera().setLight(false);
    }
    async turnOn(): Promise<void> {
        //await this.camera.findCamera().setLight(true);
    }
}

class RingCameraDevice extends ScryptedDeviceBase implements DeviceProvider, Camera, MotionSensor, BinarySensor {
    buttonTimeout: NodeJS.Timeout;
    session: SipSession;
    rtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    currentMedia: FFmpegInput | MediaStreamUrl;
    currentMediaMimeType: string;
    refreshTimeout: NodeJS.Timeout;
    picturePromise: RefreshPromise<Buffer>;

    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
        this.motionDetected = false;
        this.binaryState = false;
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.session)
            throw new Error("not in call");

        this.stopIntercom();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ringRtpOptions = this.rtpDescription;
        let cameraSpeakerActive = false;
        const audioOutForwarder = await createBindZero();
        this.audioOutForwarder = audioOutForwarder.server;
        audioOutForwarder.server.on('message', message => {
            if (!cameraSpeakerActive) {
                cameraSpeakerActive = true;
                this.session.activateCameraSpeaker().catch(e => this.console.error('camera speaker activation error', e))
            }

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
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', encodeSrtpOptions(this.session.rtpOptions.audio),
            `srtp://127.0.0.1:${audioOutForwarder.port}?pkt_size=188`,
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

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {

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


        const { clientPromise: playbackPromise, port: playbackPort } = await listenZeroSingleClient();

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
                        this.console.log('stopping sip session.');
                        sip.stop();
                    }
                    catch (e) {
                    }
                    rtsp?.destroy();
                }

                client.on('close', cleanup);
                client.on('error', cleanup);
                const camera = this.findCamera();
                sip = await camera.createSipSession(undefined);
                sip.onCallEnded.subscribe(cleanup);
                this.rtpDescription = await sip.start();
                this.console.log('sip sdp', this.rtpDescription.sdp)

                const videoPort = true ? 0 : sip.videoSplitter.address().port;
                const audioPort = true ? 0 : sip.audioSplitter.address().port;

                let sdp = replacePorts(this.rtpDescription.sdp, audioPort, videoPort);
                sdp = addTrackControls(sdp);
                sdp = sdp.split('\n').filter(line => !line.includes('a=rtcp-mux')).join('\n');
                this.console.log('proposed sdp', sdp);

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
                rtsp.console = this.console;

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

                sip.videoSplitter.once('message', message => {
                    const rtp = RtpPacket.deSerialize(message);

                    const report = new RtcpReceiverInfo({
                        ssrc: rtp.header.ssrc,
                        fractionLost: 0,
                        packetsLost: 0,
                        highestSequence: rtp.header.sequenceNumber,
                        jitter: 0,
                        lsr: 0,
                        dlsr: 0,
                    })

                    const rr = new RtcpRrPacket({
                        ssrc: rtp.header.ssrc,
                        reports: [
                            report,
                        ],
                    });

                    const interval = setInterval(() => {
                        report.highestSequence = vseq;
                        report.packetsLost = vlost;
                        report.fractionLost = Math.round(vlost * 100 / vseen);
                        const packet = srtcp.encrypt(rr.serialize());
                        sip.videoSplitter.send(packet, this.rtpDescription.video.rtcpPort, this.rtpDescription.address)
                    }, 500);
                    sip.videoSplitter.on('close', () => clearInterval(interval))
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
                    this.console.log('rtsp client ended');
                }
                catch (e) {
                    this.console.log('rtsp client ended ungracefully', e);
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
        // if (useRtsp) {
        //     const mediaStreamUrl: MediaStreamUrl = {
        //         url: playbackUrl,
        //         mediaStreamOptions,
        //     };
        //     this.currentMedia = mediaStreamUrl;
        //     this.currentMediaMimeType = ScryptedMimeTypes.MediaStreamUrl;

        //     return mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
        // }

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            container: 'sdp',
            mediaStreamOptions,
            inputArguments: [
                '-f', 'rtsp',
                '-i', 'rtsp://10.10.10.10:8554/hauseingang',
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
            container: true ? 'rtsp' : 'sdp',
            video: {
                codec: 'h264',
                h264Info: {
                    sei: true,
                    stapb: true,
                    mtap16: true,
                    mtap32: true,
                    fuab: true,
                    reserved0: true,
                    reserved30: true,
                    reserved31: true,
                }
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

    getDevice(nativeId: string) {
        return new RingCameraLight(this);
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

        const camera = this.findCamera();
        if (!camera)
            throw new Error('camera unavailable');

        // watch for snapshot being blocked due to live stream
        if (!camera.snapshotsAreBlocked) {
            try {
                buffer = await this.plugin.api.restClient.request({
                    url: `https://app-snaps.ring.com/snapshots/next/${camera.id}`,
                    responseType: 'buffer',
                    searchParams: {
                        extras: 'force',
                    },
                    headers: {
                        accept: 'image/jpeg',
                    },
                    allowNoResponse: true,
                });
            }
            catch (e) {
                this.console.error('snapshot failed, falling back to cache');
            }
        }
        if (!buffer) {
            buffer = await this.plugin.api.restClient.request({
                url: clientApi(`snapshots/image/${camera.id}`),
                responseType: 'buffer',
                allowNoResponse: true,
            });
        }

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
        const location = this.location.findLocation();
        return location.cameras?.find(camera => camera.id.toString() === this.nativeId);
    }

    // updateState(data: CameraData) {
    //     if (this.findCamera().hasLight && data.led_status) {
    //         const light = this.getDevice(undefined);
    //         light.on = data.led_status === 'on';
    //     }
    // }
}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {

    devices = new Map<string, RingCameraDevice>();

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
            this.settingsStorage.values.systemId = generateUuid();
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
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Intercom,
            ScryptedInterface.BinarySensor,
            ScryptedInterface.DeviceProvider
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
        // camera.onData.subscribe(data => {
        //     const locationDevice = this.devices.get(location.id);
        //     const scryptedDevice = locationDevice?.devices.get(nativeId);
        //     scryptedDevice?.updateState(data)
        // });

        const deviceLight: Device = {
            info: {
                model: 'SIP Cam',
                manufacturer: 'Sample Camera Manufacturer',
                firmware: "Firmware",
                serialNumber: "SerialNumber"
    },
            nativeId: "SIPCam001-light",
            name: "SIPCamName Light",
            type: ScryptedDeviceType.Light,
            interfaces: [ScryptedInterface.OnOff]
        };

        devices.push(deviceLight);

        await deviceManager.onDevicesChanged({
            devices: devices
        });

    }

    async getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const camera = new RingCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }
}

export default new RingPlugin();
