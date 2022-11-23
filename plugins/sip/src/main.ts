import { closeQuiet, createBindZero, listenZero } from '@scrypted/common/src/listen-cluster';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamUrl, PictureOptions, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import dgram from 'dgram';
import net from 'net';
import { SipSession } from './sip-session';
import { SipOptions } from './sip-call';
import { RtpDescription, isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './rtp-utils';
import { v4 as generateRandomUuid } from 'uuid';

const { deviceManager, mediaManager } = sdk;

class SipCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, BinarySensor {
    buttonTimeout: NodeJS.Timeout;
    session: SipSession;
    remoteRtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    currentMedia: FFmpegInput | MediaStreamUrl;
    currentMediaMimeType: string;
    refreshTimeout: NodeJS.Timeout;
    sipSdpPromise: Promise<string>;
    doorbellAudioActive: boolean;
    audioInProcess: ChildProcess;
    clientSocket: net.Socket;

    constructor(public plugin: SipPlugin, nativeId: string) {
        super(nativeId);
        this.binaryState = false;
        this.doorbellAudioActive = false;
        this.console.log('SipCameraDevice ctor()');
    }

    async startIntercom(media: MediaObject): Promise<void> {

        await this.callDoorbell();

        if (!this.session)
            throw new Error("not in call");

        this.stopAudioOut();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const remoteRtpDescription = this.remoteRtpDescription;
        const audioOutForwarder = await createBindZero();
        this.audioOutForwarder = audioOutForwarder.server;
        audioOutForwarder.server.on('message', message => {
            this.session.audioSplitter.send(message, remoteRtpDescription.audio.port, remoteRtpDescription.address);
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

    stopSession() {
        this.doorbellAudioActive = false;
        this.audioInProcess?.kill('SIGKILL');
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
        this.remoteRtpDescription = await sip.start();
        this.console.log('sip remote sdp', this.remoteRtpDescription.sdp)

        let [rtpPort, rtcpPort] = await SipSession.reserveRtpRtcpPorts()
        this.console.log(`Reserved RTP port ${rtpPort} and RTCP port ${rtcpPort} for incoming SIP audio`);

        const ffmpegPath = await mediaManager.getFFmpegPath();

        const ffmpegArgs = [
            '-hide_banner',
            '-nostats',
            '-f', 'rtp',
            '-i', `rtp://127.0.0.1:${rtpPort}?listen&localrtcpport=${rtcpPort}`,
            '-acodec', 'copy',
            '-f', 'mulaw',
            'pipe:3'
        ];

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioInProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));

        this.doorbellAudioActive = true;
        cp.stdio[3].on('data', data => {
            if (this.doorbellAudioActive && this.clientSocket) {
                this.clientSocket.write(data);
            }
        });

        let aseq = 0;
        let aseen = 0;
        let alost = 0;

        sip.audioSplitter.on('message', message => {
                if (!isStunMessage(message)) {
                    const isRtpMessage = isRtpMessagePayloadType(getPayloadType(message));
                    if (!isRtpMessage)
                        return;
                    aseen++;
                    sip.audioSplitter.send(message, rtpPort, "127.0.0.1");
                    const seq = getSequenceNumber(message);
                    if (seq !== (aseq + 1) % 0x0FFFF)
                        alost++;
                    aseq = seq;
                }
            });

            sip.audioRtcpSplitter.on('message', message => {
                sip.audioRtcpSplitter.send(message, rtcpPort, "127.0.0.1");
            });

            this.session = sip;
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {


        const mediaStreamOptions = Object.assign(this.getSipMediaStreamOptions(), {
            // refreshAt: Date.now() + STREAM_TIMEOUT,
        });

        const ffmpegPath = await mediaManager.getFFmpegPath();

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);

            this.clientSocket = clientSocket;

            const ffmpegArgs = [
                '-hide_banner',
                '-nostats',
                '-re',
                '-f', 'lavfi',
                '-i', 'anullsrc=r=8000:cl=mono',
                '-f', 'mulaw',
                'pipe:3'
            ];

            safePrintFFmpegArguments(console, ffmpegArgs);
            const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
            });
            ffmpegLogInitialOutput(console, cp);

            cp.stdout.on('data', data => this.console.log(data.toString()));
            cp.stderr.on('data', data => this.console.log(data.toString()));

            cp.stdio[3].on('data', data => {
                if (!this.doorbellAudioActive) {
                clientSocket.write(data);
                }
            });

            clientSocket.on('close', () => {
                cp.kill();
                this.clientSocket = null;
            });
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
                '-f', 'mulaw',
                '-ac', '1',
                '-ar', '8000',
                '-i', `tcp://127.0.0.1:${port}`
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
            container: '', // must be empty to support prebuffering
            video: {
                codec: 'h264'
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's OPUS audio and does not need transcoding.
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

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The SIP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    triggerBinaryState() {
        this.binaryState = true;
        clearTimeout(this.buttonTimeout);
        this.buttonTimeout = setTimeout(() => this.binaryState = false, 10000);
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

        // TODO: triggerBinaryState on SIP RINGING event 
        // camera.onDoorbellPressed?.subscribe(async e => {
        //     this.console.log(camera.name, 'onDoorbellPressed', e);
        //     const locationDevice = this.devices.get(location.id);
        //     const scryptedDevice = locationDevice?.devices.get(nativeId);
        //     scryptedDevice?.triggerBinaryState();
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
