import { HikvisionCamera } from "../../hikvision/src/main"
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, Reboot, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, LockState, Readme } from "@scrypted/sdk";
import { PassThrough } from "stream";
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { createRtspMediaStreamOptions, RtspProvider, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { HikvisionDoorbellAPI, HikvisionDoorbellEvent } from "./doorbell-api";
import { SipManager, SipRegistration } from "./sip-manager";
import { parseBooleans, parseNumbers } from "xml2js/lib/processors";
import { once, EventEmitter } from 'node:events';
import { timeoutPromise } from "@scrypted/common/src/promise-utils";
import { HikvisionLock } from "./lock"
import { HikvisionTamperAlert } from "./tamper-alert"
import * as fs from 'fs/promises';
import { join } from 'path';

const { mediaManager, deviceManager } = sdk;

const EXPOSE_LOCK_KEY: string = 'exposeLock';
const USE_CONTACT_SENSOR_KEY: string = 'useContactSensor';
const EXPOSE_ALERT_KEY: string = 'exposeAlert';

const SIP_MODE_KEY: string = 'sipMode';
const SIP_CLIENT_CALLID_KEY: string = 'sipClientCallId';
const SIP_CLIENT_USER_KEY: string = 'sipClientUser';
const SIP_CLIENT_PASSWORD_KEY: string = 'sipClientPassword';
const SIP_CLIENT_PROXY_IP_KEY: string = 'sipClientProxyIp';
const SIP_CLIENT_PROXY_PORT_KEY: string = 'sipClientProxyPort';
const SIP_SERVER_PORT_KEY: string = 'sipServerPort';
const SIP_SERVER_INSTALL_ON_KEY: string = 'sipServerInstallOnDevice';

const OPEN_LOCK_AUDIO_NOTIFY_DURASTION: number = 3000  // mSeconds
const UNREACHED_REPEAT_TIMEOUT: number = 10000  // mSeconds

function channelToCameraNumber(channel: string) {
    if (!channel)
        return;
    return channel.substring(0, channel.length - 2);
}

enum SipMode {
    Off = "Don't Use SIP",
    Client = "Connect to SIP Proxy", 
    Server = "Emulate SIP Proxy"
}

class HikvisionCameraDoorbell extends HikvisionCamera implements Camera, Intercom, Reboot, Readme 
{
    sipManager?: SipManager;

    private controlEvents: EventEmitter = new EventEmitter();
    private doorOpenDurationTimeout: NodeJS.Timeout;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.updateDevice();
        this.updateSip();
        this.updateDeviceInfo();
    }

    destroy(): void
    {
        this.sipManager?.stop();
        this.getEventApi()?.destroy();
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'DOORBELL_README.md');
        return fs.readFile (fileName, 'utf-8');
    }
    
    updateSip() {
        (async () => {

            if (this.sipManager) {
                this.sipManager.stop();
                delete this.sipManager;
            }
            const mode = this.getSipMode();
            if (mode !== SipMode.Off)
            {
                this.sipManager = new SipManager (this.getIPAddress(), this.console, this.storage);

                switch (mode) {
                    case SipMode.Client:
                        await this.sipManager.startClient (this.getSipClientCreds())
                        break;
                
                    default:
                        let port = parseInt (this.storage.getItem (SIP_SERVER_PORT_KEY));
                        if (port) {
                            await this.sipManager.startGateway (port);    
                        }
                        else {
                            await this.sipManager.startGateway();    
                        }
                        this.installSipSettingsOnDevice();
                        break;
                }
            }
        })();
    }

    getHttpPort(): string {
        return this.storage.getItem('httpPort') || '80';
    }

    override async listenEvents() 
    {
        let motionTimeout: NodeJS.Timeout;
        const api = this.getEventApi();
        const events = await api.listenEvents();

        let ignoreCameraNumber: boolean;
        let pulseTimeout: NodeJS.Timeout;

        let motionPingsNeeded = parseInt(this.storage.getItem('motionPings')) || 1;
        const motionTimeoutDuration = (parseInt(this.storage.getItem('motionTimeout')) || 10) * 1000;
        let motionPings = 0;
        events.on('event', async (event: HikvisionDoorbellEvent, cameraNumber: string, inactive: boolean) => {

            if (event === HikvisionDoorbellEvent.CaseTamperAlert)
            {
                const enabled = parseBooleans (this.storage.getItem (EXPOSE_ALERT_KEY));
                if (enabled)
                {
                    const provider = this.provider as HikvisionDoorbellProvider;
                    const alert = await provider.getAlertDevice (this.nativeId);
                    if (alert)
                        alert.turnOn();
                }
                else {
                    event = HikvisionDoorbellEvent.Motion;
                }
            }
            if (event === HikvisionDoorbellEvent.Motion) 
            {
                // check if the camera+channel field is in use, and filter events.
                if (this.getRtspChannel()) {
                    // it is possible to set it up to use a camera number
                    // on an nvr IP (which gives RTSP urls through the NVR), but then use a http port
                    // that gives a filtered event stream from only that camera.
                    // this this case, the camera numbers will not
                    // match as they will be always be "1".
                    // to detect that a camera specific endpoint is being used
                    // can look at the channel ids, and see if that camera number is found.
                    // this is different from the use case where the NVR or camera
                    // is using a port other than 80 (the default).
                    // could add a setting to have the user explicitly denote nvr usage
                    // but that is error prone.
                    const userCameraNumber = this.getCameraNumber();
                    if (ignoreCameraNumber === undefined && this.detectedChannels) {
                        const channelIds = (await this.detectedChannels).keys();
                        ignoreCameraNumber = true;
                        for (const id of channelIds) {
                            if (channelToCameraNumber(id) === userCameraNumber) {
                                ignoreCameraNumber = false;
                                break;
                            }
                        }
                    }

                    if (!ignoreCameraNumber && cameraNumber !== userCameraNumber) {
                        // this.console.error(`### Skipping motion event ${cameraNumber} != ${this.getCameraNumber()}`);
                        return;
                    }
                }

                motionPings++;
                // this.console.log(this.name, 'motion pings', motionPings);

                // this.console.error('### Detected motion, camera: ', cameraNumber);
                this.motionDetected = motionPings >= motionPingsNeeded;
                clearTimeout(motionTimeout);
                // motion seems to be on a 1 second pulse
                motionTimeout = setTimeout(() => {
                    this.motionDetected = false;
                    motionPings = 0;
                }, motionTimeoutDuration);
            }
            else if (event === HikvisionDoorbellEvent.TalkInvite) 
            {
                // clearTimeout(pulseTimeout);
                // pulseTimeout = setTimeout(() => this.binaryState = false, 3000);
                this.binaryState = true;
                setImmediate( () =>{
                    this.controlEvents.emit (event);
                });
            }
            else if (event === HikvisionDoorbellEvent.TalkHangup) 
            {
                this.binaryState = false;
                setImmediate( () =>{
                    this.controlEvents.emit (event);
                });
            }
            else if (event === HikvisionDoorbellEvent.Unlock)
            {
                const provider = this.provider as HikvisionDoorbellProvider;
                const lock = await provider.getLockDevice (this.nativeId);
                if (lock) 
                {
                    lock.lockState = LockState.Unlocked;

                    clearTimeout (this.doorOpenDurationTimeout);
                    const timeout = (await this.getClient().getDoorOpenDuration()) * 1000;
                    this.doorOpenDurationTimeout = setTimeout ( async () => {
    
                        const provider = this.provider as HikvisionDoorbellProvider;
                        const lock = await provider.getLockDevice (this.nativeId);
                        if (lock) {
                            lock.lockState = LockState.Locked;
                            this.console.info (`Door lock was closed automatically after duration: ${timeout}`);
                        }
                    }
                    , timeout);
                }
                    
                setTimeout(() => this.stopRinging(), OPEN_LOCK_AUDIO_NOTIFY_DURASTION);
            }
            else if (event === HikvisionDoorbellEvent.DoorOpened && parseBooleans (this.storage.getItem (USE_CONTACT_SENSOR_KEY)))
            {
                const provider = this.provider as HikvisionDoorbellProvider;
                const lock = await provider.getLockDevice (this.nativeId);
                if (lock) 
                    lock.unlock();
            }
        })

        return events;
    }

    override createClient() {
        return new HikvisionDoorbellAPI(this.getIPAddress(), this.getHttpPort(), this.getUsername(), this.getPassword(), this.console, this.storage);
    }

    override getClient(): HikvisionDoorbellAPI {
        if (!this.client)
            this.client = this.createClient();
        return this.client as HikvisionDoorbellAPI;
    }

    override async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.detectedChannels) {
            const client = this.getClient();
            this.detectedChannels = (async () => {
                const isOld = await this.isOld();

                const defaultMap = new Map<string, MediaStreamOptions>();
                const camNumber = this.getCameraNumber() || '1';
                defaultMap.set(camNumber + '01', undefined);
                defaultMap.set(camNumber + '02', undefined);

                if (isOld) {
                    this.console.error('Old NVR. Defaulting to two camera configuration');
                    return defaultMap;
                } else {
                    try {
                        return await this.getClient().getVideoChannels (camNumber);
                    }
                    catch (e) {
                        this.console.error('error retrieving channel ids', e);
                        this.detectedChannels = undefined;
                        return defaultMap;
                    }
                }
            })();
        }
        const detectedChannels = await this.detectedChannels;
        const params = this.getRtspUrlParams();

        // due to being able to override the channel number, and NVR providing per channel port access,
        // do not actually use these channel ids, and just use it to determine the number of channels
        // available for a camera.
        const ret = [];
        let index = 0;
        const cameraNumber = this.getCameraNumber();
        for (const [id, channel] of detectedChannels.entries()) {
            if (cameraNumber && channelToCameraNumber(id) !== cameraNumber)
                continue;
            const mso = createRtspMediaStreamOptions(this.getClient().rtspUrlFor(this.getRtspAddress(), id, params), index++);
            Object.assign(mso.video, channel?.video);
            mso.tool = 'scrypted';
            ret.push(mso);
        }

        return ret;
    }

    override updateDevice() 
    {
        const twoWayAudio = this.storage.getItem ('twoWayAudio') === 'true';

        const interfaces = this.provider.getInterfaces();
        if (twoWayAudio) {
            interfaces.push (ScryptedInterface.Intercom);
        }
        interfaces.push (ScryptedInterface.BinarySensor);
        interfaces.push (ScryptedInterface.Readme);
        this.provider.updateDevice (this.nativeId, this.name, interfaces, ScryptedDeviceType.Doorbell);
    }

    async updateLock () 
    {
        const enabled = parseBooleans (this.storage.getItem (EXPOSE_LOCK_KEY));
        const provider = this.provider as HikvisionDoorbellProvider;
        if (enabled) {
            return provider.enableLock (this.nativeId);
        }
        else {
            return provider.disableLock (this.nativeId);
        }
    }

    async updateAlert () 
    {
        const enabled = parseBooleans (this.storage.getItem (EXPOSE_ALERT_KEY));
        const provider = this.provider as HikvisionDoorbellProvider;
        if (enabled) {
            return provider.enableAlert (this.nativeId);
        }
        else {
            return provider.disableAlert (this.nativeId);
        }
    }

    override async putSetting(key: string, value: string) {
        this.client = undefined;
        this.detectedChannels = undefined;

        // remove 0 port for autoselect port number
        if (key === SIP_SERVER_PORT_KEY && value === '0') { 
            value = '';
        }

        super.putSetting(key, value);

        if (key === EXPOSE_LOCK_KEY) {
            this.updateLock();
        }

        if (key === EXPOSE_ALERT_KEY) {
            this.updateAlert();
        }

        this.updateDevice();
        this.updateSip();
        this.updateDeviceInfo();
    }

    onLockRemoved() 
    {
        super.putSetting(EXPOSE_LOCK_KEY, 'false');
        this.updateDevice();
    }

    onAlertRemoved() 
    {
        super.putSetting(EXPOSE_ALERT_KEY, 'false');
        this.updateDevice();
    }

    override async getSettings(): Promise<Setting[]> 
    {
        // we need override this method for removing `noaudio`, `doorbellType`, `twoWayAudio` property, 
        // which does not work properly.

        let ret = await super.getSettings();
        let idx = ret.findIndex((el) => { return el.key === 'noAudio'; });
        if (idx !== -1) {
            ret.splice(idx, 1);
        }
        idx = ret.findIndex((el) => { return el.key === 'doorbellType'; });
        if (idx !== -1) {
            ret.splice(idx, 1);
        }
        idx = ret.findIndex((el) => { return el.key === 'twoWayAudio'; });
        if (idx !== -1) {
            ret.splice(idx, 1);
        }
        return ret;
    }

    override async getOtherSettings(): Promise<Setting[]> {
        const ret = await super.getOtherSettings();

        ret.unshift(
            {
                key: EXPOSE_LOCK_KEY,
                title: 'Expose Door Lock Controller',
                description: 'The doorbell may have the capability to control door opening. Enabling this feature will result in the creation of a separate (linked) device of the "Lock" type, which implements the door lock control.',
                value: parseBooleans (this.storage.getItem (EXPOSE_LOCK_KEY)) || false,
                type: 'boolean',
            },
            {
                key: EXPOSE_ALERT_KEY,
                title: 'Expose Tamper Alert Controller',
                description: 'The doorbell may have a tamper alert. Enabling this function will lead to the creation of a separate (linked) device of the “Switch” type that implements tamper signaling.',
                value: parseBooleans (this.storage.getItem (EXPOSE_ALERT_KEY)) || false,
                type: 'boolean',
            },
            {
                key: SIP_MODE_KEY,
                title: 'SIP Mode',
                description: 'Setting up a way to interact with the doorbell in order to receive calls. Read more about how in this device description.',
                choices: Object.values (SipMode),
                combobox: true,
                value: this.storage.getItem (SIP_MODE_KEY) || SipMode.Off,
                type: 'string'
            }
        );

        ret.unshift (...this.sipSettings());

        ret.unshift({
                subgroup: 'Advanced',
                key: 'motionTimeout',
                title: 'Motion Timeout',
                description: 'Duration to report motion after the last motion ping.',
                value: parseInt(this.storage.getItem('motionTimeout')) || 10,
                type: 'number',
            },
            {
                subgroup: 'Advanced',
                key: 'motionPings',
                title: 'Motion Ping Count',
                description: 'Number of motion pings needed to trigger motion.',
                value: parseInt(this.storage.getItem('motionPings')) || 1,
                type: 'number',
            },
            {
                subgroup: 'Advanced',
                key: USE_CONTACT_SENSOR_KEY,
                title: 'Use Contact Sensor',
                description: "If you installed a contact sensor on the door when installing the Hikvision doorbell, you can use its status data to control the status of the doorlock controller, which you enabled in General Tab (\"Expose Door Lock Controller\" checkbox). To do this, enable this checkbox.",
                value: parseBooleans (this.storage.getItem (USE_CONTACT_SENSOR_KEY)) || false,
                type: 'boolean',
            },
        );

        return ret;
    }


    override async startIntercom(media: MediaObject): Promise<void> {

        await this.stopRinging();
        
        const channel = this.getRtspChannel() || '1';
        let codec: string;
        let format: string;

        try {
            codec = await this.getClient().twoWayAudioCodec(channel);
        }
        catch (e) {
            this.console.error('Failure while determining two way audio codec', e);
        }

        if (codec === 'G.711ulaw') {
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }
        else if (codec === 'G.711alaw') {
            codec = 'pcm_alaw';
            format = 'alaw'
        }
        else {
            if (codec) {
                this.console.warn('Unknown codec', codec);
                this.console.warn('Set your audio codec to G.711ulaw.');
            }
            this.console.warn('Using fallback codec pcm_mulaw. This may not be correct.');
            // seems to ship with this as defaults.
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const passthrough = new PassThrough();
        const put = this.getClient().openTwoWayAudio(channel, passthrough);

        let available = Buffer.alloc(0);
        this.activeIntercom?.kill();
        const forwarder = this.activeIntercom = await startRtpForwarderProcess(this.console, ffmpegInput, {
            audio: {
                onRtp: rtp => {
                    const parsed = RtpPacket.deSerialize(rtp);
                    available = Buffer.concat([available, parsed.payload]);
                    if (available.length > 1024) {
                        const data = available.subarray(0, 1024);
                        passthrough.push(data);
                        available = available.subarray(1024);
                    }
                },
                codecCopy: codec,
                encoderArguments: [
                    '-ar', '8000',
                    '-ac', '1',
                    '-acodec', codec,
                ]
            }
        });

        forwarder.killPromise.finally(() => {
            this.console.log('audio finished');
            passthrough.end();
            this.stopIntercom();
        });
        
        put.finally(() => forwarder.kill());
    }

    override async stopIntercom(): Promise<void> {
        this.activeIntercom?.kill();
        this.activeIntercom = undefined;

        await this.getClient().closeTwoWayAudio(this.getRtspChannel() || '1');
    }

    private getEventApi()
    {
        return (this.provider as HikvisionDoorbellProvider).createSharedClient(
            this.getIPAddress(), 
            this.getHttpPort(), 
            this.getUsername(), 
            this.getPassword(), 
            this.console,
            this.storage);
    }

    private async stopRinging ()
    {
        if (!this.binaryState) return;

        if (this.sipManager)
        {
            try 
            {
                const hup = timeoutPromise (5000, once (this.controlEvents, HikvisionDoorbellEvent.TalkHangup));
                await Promise.all ([hup, this.sipManager.answer()])
            } catch (error) {
                this.console.error (`Stop SIP ringing error: ${error}`);
            }
        }
        else {
            await this.getClient().stopRinging();
        }
    }

    /// Installs fake SIP settings on physical device, 
    /// if appropriate option is enabled (autoinstall)
    private installSipSettingsOnDeviceTimeout: NodeJS.Timeout;
    private async installSipSettingsOnDevice()
    {
        clearTimeout (this.installSipSettingsOnDeviceTimeout);
        if (this.getSipMode() === SipMode.Server
            && this.sipManager) 
        {
            const autoinstall = parseBooleans (this.storage.getItem (SIP_SERVER_INSTALL_ON_KEY))
            const ip = this.sipManager.localIp;
            const port = this.sipManager.localPort;
            if (autoinstall) { 
                try {
                    await this.getClient().setFakeSip (true, ip, port)
                    this.console.info (`Installed fake SIP settings on doorbell. Address: ${ip}, port: ${port}`);
                } catch (e) {
                    this.console.error (`Error installing fake SIP settings: ${e}`);
                    // repeat if unreached
                    this.installSipSettingsOnDeviceTimeout = setTimeout (() => this.installSipSettingsOnDevice(), UNREACHED_REPEAT_TIMEOUT);
                }
            }
        }
    }

    private sipSettings(): Setting[]
    {
        switch (this.getSipMode()) {
            case SipMode.Client:
                return [
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_CLIENT_PROXY_IP_KEY,
                        title: 'Proxy IP Address',
                        description: 'IP address of the SIP proxy to which this plugin (device) will join as a SIP telephony subscriber',
                        value: this.storage.getItem(SIP_CLIENT_PROXY_IP_KEY) || '',
                        type: 'string',
                    },
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_CLIENT_PROXY_PORT_KEY,
                        title: 'Proxy Port',
                        description: 'SIP proxy port to which this plugin (device) will join as a SIP telephony subscriber',
                        value: parseInt(this.storage.getItem(SIP_CLIENT_PROXY_PORT_KEY)) || 5060,
                        type: 'number',
                    },
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_CLIENT_USER_KEY,
                        title: 'Username',
                        description: 'Username for registration on SIP proxy',
                        value: this.storage.getItem(SIP_CLIENT_USER_KEY),
                        placeholder: 'Username',
                        type: 'string',
                    },
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_CLIENT_PASSWORD_KEY,
                        title: 'Password',
                        description: 'Password for registration on SIP proxy',
                        value: this.storage.getItem(SIP_CLIENT_PASSWORD_KEY) || '',
                        type: 'password',
                    },
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_CLIENT_CALLID_KEY,
                        title: 'Caller ID',
                        description: 'Caller ID for registration on SIP proxy',
                        value: this.storage.getItem(SIP_CLIENT_CALLID_KEY),
                        placeholder: 'CallId',
                        type: 'string',
                    },
                ];
        
            case SipMode.Server:
                return [
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: 'sipServerIp',
                        title: 'Interface IP Address',
                        description: 'Address of the interface on which the fake SIP proxy listens. Readonly property, for information.',
                        value: this.sipManager?.localIp || 'localhost',
                        type: 'string',
                        readonly: true
                    },
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: SIP_SERVER_PORT_KEY,
                        title: 'Port',
                        description: 'Specify the desired port. If you leave the field blank, the port will be assigned automatically. In this case, the selected port will be displayed in the field placeholder.',
                        value: parseInt (this.storage.getItem (SIP_SERVER_PORT_KEY)),
                        type: 'integer',
                        placeholder: `Port ${this.sipManager?.localPort || 0} is selected automatically`
                    },
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: SIP_SERVER_INSTALL_ON_KEY,
                        title: 'Autoinstall Fake SIP Proxy',
                        description: 'Install fake SIP proxy settings on a physical device (Hikvision Doorbell) automatically',
                        value: parseBooleans (this.storage.getItem (SIP_SERVER_INSTALL_ON_KEY)) || false,
                        type: 'boolean'
                    },
                ];

            default:
                break;
        }
        return []
    }

    private getSipMode() {
        return this.storage.getItem (SIP_MODE_KEY) || SipMode.Off;
    }

    private getSipClientCreds(): SipRegistration
    {
        return {
            user: this.storage.getItem (SIP_CLIENT_USER_KEY) || '',
            password: this.storage.getItem (SIP_CLIENT_PASSWORD_KEY) || '',
            ip: this.storage.getItem (SIP_CLIENT_PROXY_IP_KEY) || '',
            port: parseNumbers (this.storage.getItem (SIP_CLIENT_PROXY_PORT_KEY) || '5060'),
            callId: this.storage.getItem (SIP_CLIENT_CALLID_KEY) || ''
          }
    }
}

export class HikvisionDoorbellProvider extends RtspProvider
{
    static CAMERA_NATIVE_ID_KEY: string = 'cameraNativeId';
    
    clients: Map<string, HikvisionDoorbellAPI>;
    lockDevices: Map<string, HikvisionLock>;
    alertDevices: Map<string, HikvisionTamperAlert>;

    private static LOCK_DEVICE_PREFIX = 'hik-lock:';
    private static ALERT_DEVICE_PREFIX = 'hik-alert:';

    constructor() {
        super();
    }

    getScryptedDeviceCreator(): string {
        return 'Hikvision Doorbell';
    }

    override getAdditionalInterfaces() {
        return [
            ScryptedInterface.Reboot,
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
        ];
    }

    createSharedClient (ip: string, port: string, username: string, password: string, console: Console, storage: Storage) 
    {
        if (!this.clients)
            this.clients = new Map();

        const key = `${ip}#${port}#${username}#${password}`;
        const check = this.clients.get(key);
        if (check) 
            return check;
        
        const client = new HikvisionDoorbellAPI (ip, port, username, password, console, storage);
        this.clients.set (key, client);
        return client;
    }

    override createCamera(nativeId: string) {
        return new HikvisionCameraDoorbell(nativeId, this);
    }

    override async getDevice (nativeId: string): Promise<any>
    {
        if (this.isLockId (nativeId))
        {
            if (typeof (this.lockDevices) === 'undefined') {
                this.lockDevices = new Map();
            }

            let ret = this.lockDevices.get (nativeId);
            if (!ret) 
            {
                ret = new HikvisionLock (nativeId, this);
                if (ret)
                    this.lockDevices.set(nativeId, ret);
            }
            return ret;
        }
        else if (this.isAlertId (nativeId)) 
        {
            if (typeof (this.alertDevices) === 'undefined') {
                this.alertDevices = new Map();
            }

            let ret = this.alertDevices.get (nativeId);
            if (!ret) 
            {
                ret = new HikvisionTamperAlert (nativeId);
                if (ret)
                    this.alertDevices.set(nativeId, ret);
            }
            return ret;
        }

        return super.getDevice (nativeId);
    }

    async getLockDevice (cameraNativeId: string): Promise<HikvisionLock>
    {
        const nativeId = this.lockIdFrom (cameraNativeId);
        return this.getDevice (nativeId);
    }

    async getAlertDevice (cameraNativeId: string): Promise<HikvisionTamperAlert>
    {
        const nativeId = this.alertIdFrom (cameraNativeId);
        return this.getDevice (nativeId);
    }

    override async releaseDevice(id: string, nativeId: string): Promise<void> {

        this.console.error(`Release device: ${id}, ${nativeId}`);
        const camera = this.getCameraDeviceFor (nativeId, false);
        if (this.isLockId (nativeId))
        {
            camera.onLockRemoved();
            this.lockDevices.delete (nativeId);
            return;
        }
        if (this.isAlertId (nativeId))
        {
            camera.onAlertRemoved();
            this.alertDevices.delete (nativeId);
            return;
        }
        await this.disableLock (nativeId);
        await this.disableAlert (nativeId);
        this.devices.delete(nativeId);
        camera?.destroy();
    }

    override async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate?.toString() === 'true';
        let twoWayAudio: string;
        if (!skipValidate) {
            const api = new HikvisionDoorbellAPI(`${settings.ip}`, `${settings.httpPort || '80'}`, username, password, this.console, this.storage);
            try {
                const deviceInfo = await api.getDeviceInfo();

                settings.newCamera = deviceInfo.deviceName;
                info.model = deviceInfo.deviceModel;
                // info.manufacturer = 'Hikvision';
                info.mac = deviceInfo.macAddress;
                info.firmware = deviceInfo.firmwareVersion;
                info.serialNumber = deviceInfo.serialNumber;
            }
            catch (e) {
                this.console.error('Error adding Hikvision camera', e);
                throw e;
            }

            try {
                if (await api.checkTwoWayAudio()) {
                    twoWayAudio = 'true';
                }
            }
            catch (e) {
                this.console.warn('Error probing two way audio', e);
            }
        }
        settings.newCamera ||= 'Hikvision Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as HikvisionCameraDoorbell;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.setIPAddress(settings.ip?.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());
        if (twoWayAudio)
            device.putSetting('twoWayAudio', twoWayAudio);
        device.updateSip();
        device.updateDeviceInfo();
        return nativeId;
    }

    async enableLock (cameraNativeId: string)
    {
        const camera = await this.getCameraDeviceFor (cameraNativeId)
        const nativeId = this.lockIdFrom (cameraNativeId);
        const name = `${camera.name} (Door Lock)`
        await this.updateLock (nativeId, name);
        await this.cameraMetaToAux (nativeId, camera);
    }

    async disableLock (cameraNativeId: string)
    {
        const nativeId = this.lockIdFrom (cameraNativeId);
        return this.removingAuxNotify (nativeId)
    }

    async updateLock (nativeId: string, name?: string)
    {
        await deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: HikvisionLock.deviceInterfaces,
            type: ScryptedDeviceType.Lock
        });

    }

    async enableAlert (cameraNativeId: string)
    {
        const camera = await this.getCameraDeviceFor (cameraNativeId)
        const nativeId = this.alertIdFrom (cameraNativeId);
        const name = `${camera.name} (Doorbell Tamper Alert)`
        await this.updateAlert (nativeId, name);
        await this.cameraMetaToAux (nativeId, camera);
    }

    async disableAlert (cameraNativeId: string)
    {
        const nativeId = this.alertIdFrom (cameraNativeId);
        return this.removingAuxNotify (nativeId)
    }

    async updateAlert (nativeId: string, name?: string)
    {
        await deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: HikvisionTamperAlert.deviceInterfaces,
            type: ScryptedDeviceType.Switch
        });

    }

    private async cameraMetaToAux (nativeId: string, camera: HikvisionCameraDoorbell)
    {
        const user = camera.storage.getItem ('username');
        const pass = camera.storage.getItem ('password');
        const aux = await this.getDevice (nativeId) as Settings;
        aux.putSetting ('user', user);
        aux.putSetting ('pass', pass);
        aux.putSetting ('ip', camera.getIPAddress());
        aux.putSetting ('port', camera.getHttpPort());
        aux.putSetting (HikvisionDoorbellProvider.CAMERA_NATIVE_ID_KEY, camera.nativeId);
    }

    private async removingAuxNotify (nativeId: string)
    {
        const state = deviceManager.getDeviceState (nativeId);
        if (state?.nativeId === nativeId) {
            return deviceManager.onDeviceRemoved (nativeId)
        }
    }

    override async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            {
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80',
                placeholder: '80',
            },
            {
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    private lockIdFrom (cameraNativeId: string): string {
        return `${HikvisionDoorbellProvider.LOCK_DEVICE_PREFIX}${cameraNativeId}`
    }
    
    private alertIdFrom (cameraNativeId: string): string {
        return `${HikvisionDoorbellProvider.ALERT_DEVICE_PREFIX}${cameraNativeId}`
    }

    private isLockId (nativeId: string):boolean {
        return nativeId.startsWith (HikvisionDoorbellProvider.LOCK_DEVICE_PREFIX);
    }

    private isAlertId (nativeId: string):boolean {
        return nativeId.startsWith (HikvisionDoorbellProvider.ALERT_DEVICE_PREFIX);
    }

    private cameraIdFrom (nativeId: string): string 
    {
        if (this.isLockId (nativeId)) {
            return nativeId.substring (HikvisionDoorbellProvider.LOCK_DEVICE_PREFIX.length);
        }
        if (this.isAlertId (nativeId)) {
            return nativeId.substring (HikvisionDoorbellProvider.ALERT_DEVICE_PREFIX.length);
        }
        return nativeId;
    }

    private getCameraDeviceFor (nativeId, check: boolean = true): HikvisionCameraDoorbell
    {
        try 
        {
            const cameraId = this.cameraIdFrom (nativeId);
            if (check)
            {
                const state = deviceManager.getDeviceState (cameraId);
                if (state?.nativeId !== cameraId)
                    return null;
            }
            return this.devices?.get (cameraId);
        } catch (error) 
        {
            this.console.warn (`Error obtaining camera device: ${error}`);
            return null;
        }
    }
}

export default new HikvisionDoorbellProvider();
