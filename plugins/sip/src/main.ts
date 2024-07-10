import { closeQuiet, createBindZero, listenZero } from '@scrypted/common/src/listen-cluster';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { BinarySensor, Camera, DeviceProvider, DeviceCreator, DeviceCreatorSettings, FFmpegInput, Intercom, MediaObject, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import dgram from 'dgram';
import net from 'net';
import { SipCallSession } from './sip-call-session';
import { SipOptions } from './sip-manager';
import { RtpDescription, isStunMessage, getPayloadType, getSequenceNumber, isRtpMessagePayloadType } from './rtp-utils';
import { randomBytes } from "crypto";

const { deviceManager, mediaManager } = sdk;

class SipCamera extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, Settings, BinarySensor {
    buttonTimeout: NodeJS.Timeout;
    callSession: SipCallSession;
    remoteRtpDescription: RtpDescription;
    audioOutForwarder: dgram.Socket;
    audioOutProcess: ChildProcess;
    doorbellAudioActive: boolean;
    audioInProcess: ChildProcess;
    audioSilenceProcess: ChildProcess;
    clientSocket: net.Socket;

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

    storageSettings = new StorageSettings(this, {
        ffmpegInputs: {
            title: 'RTSP Stream URL',
            description: 'An RTSP Stream URL provided by the camera.',
            placeholder: 'rtsp://192.168.1.100[:554]/channel/101',
            // TODO: Support different streams to support different resolutions
            multiple: true,
        },
    })

    async getFFmpegInputSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue) {
        if (this.storageSettings.settings[key]) {
            this.storageSettings.putSetting(key, value);
        }
        else if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id || '');
        }
        else {
            this.storage.setItem(key, value.toString());
        }

        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
                value: this.storage.getItem('username'),
                description: 'Optional: Username for snapshot http requests.',
            },
            {
                key: 'password',
                title: 'Password',
                value: this.storage.getItem('password'),
                type: 'password',
                description: 'Optional: Password for snapshot http requests.',
            },
            ...await this.getFFmpegInputSettings(),
            {
                key: 'sipfrom',
                title: 'SIP From: URI',
                value: this.storage.getItem('sipfrom'),
                description: 'SIP URI From: field. Host part is the local IP to listen on. Optional local UDP port for SIP signaling can be specified.',
                placeholder: '1234@192.168.0.111[:5060]',
                multiple: false,
            },
            {
                key: 'sipto',
                title: 'SIP To: URI',
                value: this.storage.getItem('sipto'),
                description: 'SIP URI To: field.',
                placeholder: '11@192.168.0.22',
                multiple: false,
            },
        ];
    }

    async startIntercom(media: MediaObject): Promise<void> {

        await this.callDoorbell();

        if (!this.callSession)
            throw new Error("not in call");

        this.stopAudioOut();

        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const remoteRtpDescription = this.remoteRtpDescription;
        const audioOutForwarder = await createBindZero();
        this.audioOutForwarder = audioOutForwarder.server;
        audioOutForwarder.server.on('message', message => {
            this.callSession.audioSplitter.send(message, remoteRtpDescription.audio.port, remoteRtpDescription.address);
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
        this.callSession.onCallEnded.subscribe(() => {
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
        if (this.callSession) {
            this.console.log('ending sip session');
            this.callSession.stop();
            this.callSession = undefined;
        }
    }

    async callDoorbell(): Promise<void> {
        let sip: SipCallSession;

        const cleanup = () => {
            if (this.callSession === sip)
                this.callSession = undefined;
            try {
                this.console.log('stopping sip session.');
                sip.stop();
            }
            catch (e) {
            }
        }

        const from = this.storage.getItem('sipfrom');
        const to = this.storage.getItem('sipto');
        const localIp = from.split(':')[0].split('@')[1];
        const localPort = parseInt(from.split(':')[1]) || 5060;

        if (!from || !to || !localIp || !localPort) {
            this.console.error('SIP From: and To: URIs not specified!');
            return;
        }

        this.console.log(`SIP: Calling doorbell: From: ${from}, To: ${to}`);
        this.console.log(`SIP: localIp: ${localIp}, localPort: ${localPort}`);

        let sipOptions: SipOptions = { from: "sip:" + from, to: "sip:" + to, localIp, localPort };

        sip = await SipCallSession.createCallSession(this.console, this.name, sipOptions);
        sip.onCallEnded.subscribe(cleanup);
        this.remoteRtpDescription = await sip.call(
            ( audio ) => {
                return [
                    `m=audio ${audio.port} RTP/AVP 0`,
                    'a=rtpmap:0 PCMU/8000',
                    'a=sendrecv'
                ]
            }
        );
        this.console.log('SIP: Received remote SDP:\n', this.remoteRtpDescription.sdp)

        let [rtpPort, rtcpPort] = await SipCallSession.reserveRtpRtcpPorts()
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

        this.callSession = sip;
    }

    getRawVideoStreamOptions(): ResponseMediaStreamOptions[] {
        const ffmpegInputs = this.storageSettings.values.ffmpegInputs as string[];

        // filter out empty strings.
        const ret = ffmpegInputs
            .filter(ffmpegInput => !!ffmpegInput)
            .map((ffmpegInput, index) => this.createFFmpegMediaStreamOptions(ffmpegInput, index));

        if (!ret.length)
            return;
        return ret;

    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const vsos = this.getRawVideoStreamOptions();
        return vsos;
    }

    getDefaultStream(vsos: ResponseMediaStreamOptions[]) {
        return vsos?.[0];
    }

    async getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos?.find(s => s.id === options?.id) || this.getDefaultStream(vsos);
        return this.createVideoStream(vso);
    }


    createFFmpegMediaStreamOptions(ffmpegInput: string, index: number) {
        try {
        }
        catch (e) {
        }

        return {
            id: `channel${index}`,
            name: `Stream ${index + 1}`,
            url: undefined,
            container: '', // must be empty to support prebuffering
            video: {
                codec: 'h264',
                h264Info: {
                    sei: false,
                    stapb: false,
                    mtap16: false,
                    mtap32: false,
                    fuab: false,
                    reserved0: false,
                    reserved30: false,
                    reserved31: false,
                }
            },
            audio: { /*this.isAudioDisabled() ? null : {}, */
                // this is a hint to let homekit, et al, know that it's OPUS audio and does not need transcoding.
                codec: 'pcm_mulaw',
            },
        };
    }

    async startSilenceGenerator() {

        if (this.audioSilenceProcess)
            return;

        const ffmpegPath = await mediaManager.getFFmpegPath();
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
        this.audioSilenceProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));
        cp.stdio[3].on('data', data => {
            if (!this.doorbellAudioActive && this.clientSocket) {
                this.clientSocket.write(data);
            }
        });
    }

    stopSilenceGenerator() {
        this.audioSilenceProcess?.kill();
        this.audioSilenceProcess = null;
    }

    async startAudioServer(): Promise<number> {

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);

            this.clientSocket = clientSocket;

            this.startSilenceGenerator();

            this.clientSocket.on('close', () => {
                this.stopSilenceGenerator();
                this.clientSocket = null;
            });
        });
        const serverTimeout = setTimeout(() => {
            this.console.log('timed out waiting for client');
            server.close();
        }, 30000);
        const port = await listenZero(server);

        return port;
    }

    async createVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
        const index = this.getRawVideoStreamOptions()?.findIndex(vso => vso.id === options.id);
        const ffmpegInputs = this.storageSettings.values.ffmpegInputs as string[];
        const ffmpegInput = ffmpegInputs[index];

        if (!ffmpegInput)
            throw new Error('video streams not set up or no longer exists.');

        const port = await this.startAudioServer();

        const ret: FFmpegInput = {
            url: undefined,
            inputArguments: [
                '-analyzeduration', '0',
                '-probesize', '32',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                '-i', ffmpegInput, //'rtsp://10.10.10.10:8554/hauseingang',
                '-f', 'mulaw',
                '-ac', '1',
                '-ar', '8000',
                '-channel_layout', 'mono',
                '-use_wallclock_as_timestamps', 'true',
                '-i', `tcp://127.0.0.1:${port}?tcp_nodelay=1`,
            ],
            mediaStreamOptions: options,
        };

        return mediaManager.createFFmpegMediaObject(ret);
    }

    triggerBinaryState() {
        this.binaryState = true;
        clearTimeout(this.buttonTimeout);
        this.buttonTimeout = setTimeout(() => this.binaryState = false, 10000);
    }
}

export class SipCamProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);
        this.systemDevice = {
            deviceCreator: 'SIP Camera',
        };
        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }
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

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        if( this.devices.delete( nativeId ) ) {
            this.console.log("Removed device from list: " + id + " / " + nativeId )   
        }
    }    

    createCamera(nativeId: string): SipCamera {
        return new SipCamera(nativeId, this);
    }
}

export default new SipCamProvider();
