import { HikvisionCamera } from "../../hikvision/src/main"
import sdk, { Camera, Device, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, Reboot, RequestPictureOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, LockState, Readme } from "@scrypted/sdk";
import { PassThrough } from "stream";
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { createRtspMediaStreamOptions, RtspProvider, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { HikvisionDoorbellAPI, HikvisionDoorbellEvent } from "./doorbell-api";
import { SipManager, SipRegistration, SipAudioTarget } from "./sip-manager";
import { parseNumbers } from "xml2js/lib/processors";
import { EventEmitter } from 'node:events';
import { timeoutPromise } from "@scrypted/common/src/promise-utils";
import { HikvisionLock } from "./lock"
import { HikvisionEntrySensor } from "./entry-sensor"
import { HikvisionTamperAlert } from "./tamper-alert"
import * as fs from 'fs/promises';
import { join } from 'path';
import { makeDebugConsole, DebugController } from "./debug-console";
import { RtpStreamSwitcher } from "./rtp-stream-switcher";
import { HttpStreamSwitcher, HttpSession } from "./http-stream-switcher";

const { mediaManager } = sdk;

const PROVIDED_DEVICES_KEY: string = 'providedDevices';


const SIP_MODE_KEY: string = 'sipMode';
const SIP_CLIENT_CALLID_KEY: string = 'sipClientCallId';
const SIP_CLIENT_USER_KEY: string = 'sipClientUser';
const SIP_CLIENT_PASSWORD_KEY: string = 'sipClientPassword';
const SIP_CLIENT_PROXY_IP_KEY: string = 'sipClientProxyIp';
const SIP_CLIENT_PROXY_PORT_KEY: string = 'sipClientProxyPort';
const SIP_SERVER_PORT_KEY: string = 'sipServerPort';
const SIP_SERVER_ROOM_NUMBER_KEY: string = 'sipServerRoomNumber';
const SIP_SERVER_PROXY_PHONE_KEY: string = 'sipServerProxyPhone';
const SIP_SERVER_DOORBELL_PHONE_KEY: string = 'sipServerDoorbellPhone';
const SIP_SERVER_BUTTON_NUMBER_KEY: string = 'sipServerButtonNumber';

const DEFAULT_ROOM_NUMBER: string = '5871';
const DEFAULT_PROXY_PHONE: string = '10102';
const DEFAULT_DOORBELL_PHONE: string = '10101';
const DEFAULT_BUTTON_NUMBER: string = '1';

const LOCK_AUDIO_NOTIFY_SEC: number = 3  // Duration to play audio notification after door unlock
const UNREACHED_RETRY_SEC: number = 10  // Retry timeout when device is unreachable
const CANCEL_CALL_DELAY_SEC: number = 3  // Delay before killing active intercom after cancelCall
const GRACE_PERIOD_SEC: number = 2  // Grace period for seamless SIP reconnection
const HTTP_SWITCH_DELAY_SEC: number = 1  // Delay between closing old and opening new HTTP session

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

export class HikvisionCameraDoorbell extends HikvisionCamera implements Camera, Intercom, Reboot, Readme {
    locks: Map<string, HikvisionLock> = new Map();
    entrySensors: Map<string, HikvisionEntrySensor> = new Map();
    tamperAlert?: HikvisionTamperAlert;
    sipManager?: SipManager;

    private controlEvents: EventEmitter = new EventEmitter();
    private doorOpenDurationTimeout: NodeJS.Timeout;
    private debugController: DebugController;
    
    // intercom state protection
    private intercomBusy: boolean = false;
    private stopIntercomQueue: Promise<void> = Promise.resolve();
    
    // grace period for seamless reconnection
    private gracePeriodTimer?: NodeJS.Timeout;
    private waitingForReconnect: boolean = false;
    
    // RTP stream switcher for seamless target switching (SIP mode)
    private rtpStreamSwitcher?: RtpStreamSwitcher;
    
    // HTTP stream switcher for seamless reconnection (ISAPI mode)
    private httpStreamSwitcher?: HttpStreamSwitcher;
    
    // Dedicated API client for event handling
    private eventApi?: HikvisionDoorbellAPI;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.debugController = makeDebugConsole (this.console);
        // Set debug mode from storage
        const debugEnabled = this.storage.getItem ('debug');
        this.debugController.setDebugEnabled (debugEnabled === 'true');
        
        this.updateSip();
    }

    destroy(): void
    {
        this.clearGracePeriod();
        this.rtpStreamSwitcher?.destroy();
        this.rtpStreamSwitcher = undefined;
        this.httpStreamSwitcher?.destroy();
        this.httpStreamSwitcher = undefined;
        this.sipManager?.stop();
        this.eventApi?.destroy();
        this.eventApi = undefined;
        (this.client as HikvisionDoorbellAPI)?.destroy();
        this.client = undefined;
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
                        const callId = this.storage.getItem (SIP_SERVER_PROXY_PHONE_KEY) || DEFAULT_PROXY_PHONE;
                        let port = parseInt (this.storage.getItem (SIP_SERVER_PORT_KEY));
                        await this.sipManager.startGateway (callId, port);    
                        this.installSipSettingsOnDevice();
                        break;
                }
            }

            this.configureSipHandlers();
        })();
    }

    getHttpPort(): string {
        return this.storage.getItem('httpPort') || '80';
    }

    override async listenEvents() 
    {
        let motionTimeout: NodeJS.Timeout;
        if (!this.eventApi) {
            this.eventApi = this.createEventApi();
        }
        const events = await this.eventApi.listenEvents();

        let motionPingsNeeded = parseInt(this.storage.getItem('motionPings')) || 1;
        const motionTimeoutDuration = (parseInt(this.storage.getItem('motionTimeout')) || 10) * 1000;
        let motionPings = 0;
        events.on('event', async (event: HikvisionDoorbellEvent, doorNo: string) => {

            if (event === HikvisionDoorbellEvent.CaseTamperAlert)
            {
                if (this.tamperAlert) {
                    this.tamperAlert.turnOn();
                }
                else {
                    event = HikvisionDoorbellEvent.Motion;
                }
            }
            if (event === HikvisionDoorbellEvent.Motion) 
            {
                motionPings++;
                this.motionDetected = motionPings >= motionPingsNeeded;
                clearTimeout(motionTimeout);
                // motion seems to be on a 1 second pulse
                motionTimeout = setTimeout(() => {
                    this.motionDetected = false;
                    motionPings = 0;
                }, motionTimeoutDuration);
            }
            else if (event === HikvisionDoorbellEvent.TalkInvite 
                || event === HikvisionDoorbellEvent.TalkOnCall 
                || event === HikvisionDoorbellEvent.TalkHangup) 
            {
                const invite = (event === HikvisionDoorbellEvent.TalkInvite);
                this.console.info (`Doorbell ${event.toString()} detected`);
                if (this.intercomBusy && invite) 
                {
                    this.stopCall().then(() => {
                        // Check if we're in ISAPI mode (no SIP) and can do seamless reconnection
                        if (!this.sipManager && this.httpStreamSwitcher) 
                        {
                            this.console.info ('(ISAPI) Received TalkInvite during active intercom, attempting seamless reconnection');

                            // Attempt to reconnect HTTP session without stopping audio forwarder
                            this.switchHttpSession().then (session => {
                                if (session) {
                                    this.console.info('Seamless HTTP reconnection successful');
                                } else {
                                    this.console.warn('Failed to reconnect HTTP session, stopping intercom');
                                    this.stopIntercom();
                                }
                            }).catch(e => {
                                this.console.error('Error during HTTP reconnection:', e);
                                this.stopIntercom();
                            });
                        }
                    });
                    return;
                }

                this.binaryState = invite;
                setImmediate( () => {
                    this.controlEvents.emit (event.toString());
                });
            }
            else if (event === HikvisionDoorbellEvent.Unlock 
                || event === HikvisionDoorbellEvent.Lock)
            {
                // Update specific lock based on doorNo
                const lockNativeId = `${this.nativeId}-lock-${doorNo}`;
                const lock = this.locks.get (lockNativeId);
                
                if (lock) {
                    const isUnlock = event === HikvisionDoorbellEvent.Unlock;
                    lock.lockState = isUnlock ? LockState.Unlocked : LockState.Locked;
                    this.console.info (`Door ${doorNo} ${isUnlock ? 'unlocked' : 'locked'}`);
                    
                    clearTimeout (this.doorOpenDurationTimeout);
                    
                    if (isUnlock && this.binaryState) {
                        setTimeout (() => this.stopCall(), LOCK_AUDIO_NOTIFY_SEC * 1000);
                    }
                } else {
                    this.console.warn (`Lock for door ${doorNo} not found`);
                }
            }
            else if (
                (event === HikvisionDoorbellEvent.DoorOpened 
                || event === HikvisionDoorbellEvent.DoorClosed
            || event === HikvisionDoorbellEvent.DoorAbnormalOpened)
            ) 
            {
                // Update specific entry sensor based on door state and doorNo
                const sensorNativeId = `${this.nativeId}-entry-${doorNo}`;
                const entrySensor = this.entrySensors.get (sensorNativeId);
                
                if (entrySensor) {
                    const isOpen = event !== HikvisionDoorbellEvent.DoorClosed;
                    if (isOpen && this.binaryState) { this.stopCall(); }
                    entrySensor.binaryState = isOpen;
                    this.console.info (`Door ${doorNo} entry sensor: ${isOpen ? 'opened' : 'closed'}`);
                } else {
                    this.console.warn (`Entry sensor for door ${doorNo} not found`);
                }
            }
        })

        return events;
    }

    private async stopCall(): Promise<void>
    {
        try
        {
            if (this.sipManager) {
                await this.sipManager.answer();
                await this.sipManager.hangup();
            }
            else {
                await this.getClient().cancelCall();
            }
        }
        catch (e)
        {
            this.console.error ('Failed to cancel call:', e);
        }
    }

    private createSipAudioTrack (codec: string, useSwitcher: boolean = false)
    {
        let flag = true;
        
        if (useSwitcher) {
            // Use switcher for seamless target switching support
            return {
                onRtp: (rtp: Buffer) => {
                    if (flag) {
                        this.console.debug ('First RTP packet, sending to switcher');
                        flag = false;
                    }
                    // Send to switcher which will forward to current active target
                    this.rtpStreamSwitcher?.sendRtp (rtp);
                },
                codecCopy: codec,
                encoderArguments: [
                    '-ar', '8000',
                    '-ac', '1',
                    '-acodec', codec,
                ]
            };
        } else {
            // Direct RTP mode (fallback if switcher not used)
            const target = this.sipManager?.remoteAudioTarget;
            if (!target) {
                throw new Error ('No remote audio target available');
            }
            
            return {
                onRtp: (rtp: Buffer) => {
                    if (flag) {
                        this.console.debug (`First RTP packet sent to ${target.ip}:${target.port}`);
                        flag = false;
                    }
                },
                codecCopy: codec,
                encoderArguments: [
                    '-ar', '8000',
                    '-ac', '1',
                    '-acodec', codec,
                    '-f', 'rtp',
                    `rtp://${target.ip}:${target.port}`,
                ]
            };
        }
    }

    private clearGracePeriod()
    {
        if (this.gracePeriodTimer) {
            clearTimeout (this.gracePeriodTimer);
            this.gracePeriodTimer = undefined;
        }
        this.waitingForReconnect = false;
    }

    private async attemptSipReconnection(): Promise<void>
    {
        this.console.info ('Grace period expired, attempting reconnection via INVITE');
        this.clearGracePeriod();
        
        // Check if intercom is still active before attempting reconnection
        if (!this.activeIntercom || this.activeIntercom.killed) 
        {
            this.console.info ('Intercom was stopped during grace period, skipping reconnection');
            return;
        }
        
        const mng = this.sipManager;
        if (!mng) 
        {
            this.console.error ('SIP manager not available, stopping intercom');
            await this.stopIntercom();
            return;
        }
        
        // Try to send INVITE to doorbell to re-establish connection
        try 
        {
            const inviteSuccess = await mng.invite();
            if (inviteSuccess) 
            {
                this.console.info ('INVITE successful, received SDP response');
                
                // Switch to new audio target from SDP response
                const switched = await this.switchAudioTarget();
                if (!switched) {
                    this.console.error ('Failed to switch audio target, stopping intercom');
                    await this.stopIntercom();
                    return;
                }
                
                this.console.info ('Reconnection successful via INVITE');
            } 
            else 
            {
                this.console.warn ('INVITE failed, stopping intercom');
                await this.stopIntercom();
            }
        } 
        catch (error) 
        {
            this.console.error ('Error during reconnection attempt:', error);
            await this.stopIntercom();
        }
    }

    private async switchAudioTarget (): Promise<boolean>
    {
        if (!this.rtpStreamSwitcher) {
            this.console.warn ('Cannot switch audio target: switcher not initialized');
            return false;
        }

        const newTarget = this.sipManager?.remoteAudioTarget;
        if (!newTarget) {
            this.console.error ('Cannot switch audio target: missing remote audio target');
            return false;
        }

        try {
            this.console.info (`Switching audio target to ${newTarget.ip}:${newTarget.port}`);
            
            // Switch to new target
            // This allows seamless switching without killing the forwarder
            this.rtpStreamSwitcher.switchTarget (newTarget.ip, newTarget.port);
            
            this.console.info ('Audio target switched successfully');
            return true;
        } catch (error) {
            this.console.error ('Failed to switch audio target:', error);
            return false;
        }
    }

    private setupPutPromiseHandlers (put: Promise<any>): void
    {
        put.finally (() => {
            // Only kill forwarder if this is still the current PUT request
            if (this.activeIntercom && !this.activeIntercom.killed && this.httpStreamSwitcher?.isCurrentPutPromise (put)) {
                this.console.debug ('Current PUT finished, cleaning up');
                this.activeIntercom.kill();
            } else if (!this.httpStreamSwitcher?.isCurrentPutPromise (put)) {
                this.console.debug ('Old PUT finished, ignoring (new session active)');
            }
        });
        
        // The PUT request will be open until the passthrough is closed
        put.then (response => {
            // Only kill forwarder if this is still the current PUT request
            if (response.statusCode !== 200 && this.activeIntercom && !this.activeIntercom.killed && this.httpStreamSwitcher?.isCurrentPutPromise (put)) {
                this.console.debug ('Current PUT finished with non-200 status code, cleaning up');
                this.activeIntercom.kill();
            }
        })
            .catch (() => {
                // Only kill forwarder if this is still the current PUT request
                if (this.activeIntercom && !this.activeIntercom.killed && this.httpStreamSwitcher?.isCurrentPutPromise (put)) {
                    this.console.debug ('Current PUT finished with error, cleaning up');
                    this.activeIntercom.kill();
                }
            });
    }

    private async switchHttpSession (initialSetup: boolean = false): Promise<HttpSession | null>
    {
        // Initialize switcher if not exists (only for initial setup)
        if (!this.httpStreamSwitcher) {
            if (initialSetup) {
                this.httpStreamSwitcher = new HttpStreamSwitcher (this.console);
            } else {
                this.console.warn ('Cannot switch HTTP session: switcher not initialized');
                return null;
            }
        }

        try {
            if (initialSetup) {
                this.console.info ('Initializing HTTP session');
            } else {
                this.console.info ('Switching HTTP session for seamless reconnection');
            }
            
            const channel = this.getRtspChannel() || '1';
            
            // Store old session info for cleanup
            const oldSessionId = this.httpStreamSwitcher.getCurrentSessionId();
            
            // Close old session BEFORE opening new one (required by device)
            if (oldSessionId) {
                try {
                    await this.getClient().closeTwoWayAudio (channel, oldSessionId);
                    this.console.debug (`Old HTTP session ${oldSessionId} closed before opening new`);
                } catch (e) {
                    this.console.warn (`Failed to close old session ${oldSessionId}:`, e);
                }
                
                // Wait before opening new session
                await new Promise (resolve => setTimeout (resolve, HTTP_SWITCH_DELAY_SEC * 1000));
                this.console.debug (`Waited ${HTTP_SWITCH_DELAY_SEC}s before opening new session`);
            }
            
            // Open new HTTP session
            const newPassthrough = new PassThrough();
            const result = await this.getClient().openTwoWayAudio (channel, newPassthrough);
            const newSessionId = result.sessionId;
            const newPut = result.result;
            
            // Create session object and switch
            const newSession: HttpSession = {
                sessionId: newSessionId,
                stream: newPassthrough,
                putPromise: newPut
            };
            
            this.httpStreamSwitcher.switchSession (newSession);
            
            if (oldSessionId) {
                this.console.info (`HTTP session switched: ${oldSessionId} -> ${newSessionId}`);
            } else {
                this.console.debug (`HTTP session ${newSessionId} connected to switcher`);
            }
            
            // Setup PUT promise handlers if forwarder is active
            if (this.activeIntercom) {
                this.setupPutPromiseHandlers (newPut);
            }
            
            return newSession;
        } catch (error) {
            this.console.error ('Failed to switch HTTP session:', error);
            return null;
        }
    }

    override createClient() {
        return new HikvisionDoorbellAPI(
            this.getIPAddress(), 
            this.getHttpPort(), 
            this.getUsername(), 
            this.getPassword(), 
            this.isCallPolling(),
            this.console, 
            this.storage
        );
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

        const providedDevices = JSON.parse(this.storage.getItem(PROVIDED_DEVICES_KEY) || '[]') as string[];

        const interfaces = this.provider.getInterfaces();
        if (twoWayAudio) {
            interfaces.push (ScryptedInterface.Intercom);
        }
        interfaces.push (ScryptedInterface.BinarySensor);
        interfaces.push (ScryptedInterface.Readme);
        
        if (!!providedDevices?.length) {
            interfaces.push(ScryptedInterface.DeviceProvider);
        }
        
        this.provider.updateDevice (this.nativeId, this.name, interfaces, ScryptedDeviceType.Doorbell);
    }

    override async reportDevices()
    {
        const providedDevices = JSON.parse (this.storage.getItem (PROVIDED_DEVICES_KEY) || '[]') as string[];
        const devices: Device[] = [];

        if (providedDevices?.includes ('Locks')) {
            try {
                const lockDevices = await this.createLockDevices();
                devices.push (...lockDevices);
            } catch (error) {
                this.console.warn (`Failed to create lock devices: ${error}`);
            }
        }

        if (providedDevices?.includes ('Contact Sensors')) {
            try {
                const sensorDevices = await this.createEntrySensorDevices();
                devices.push(...sensorDevices);
            } catch (error) {
                this.console.warn (`Failed to create entry sensor devices: ${error}`);
            }
        }

        if (providedDevices?.includes ('Tamper Alert')) {
            const alertNativeId = `${this.nativeId}-alert`;
            const alertDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} (Doorbell Tamper Alert)`,
                nativeId: alertNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff,
                    ScryptedInterface.Readme
                ],
                type: ScryptedDeviceType.Switch,
            };
            devices.push (alertDevice);
        }
        sdk.deviceManager.onDevicesChanged ({
            providerNativeId: this.nativeId,
            devices,
        });
    }

    private async createLockDevices(): Promise<Device[]>
    {
        const devices: Device[] = [];
        
        try {
            const client = this.getClient();
            const doorRange = await client.getDoorControlCapabilities();
            
            for (let doorNo = doorRange.doorMinNo; doorNo <= doorRange.doorMaxNo; doorNo++) {
                const lockNativeId = `${this.nativeId}-lock-${doorNo}`;
                const lockDevice: Device = {
                    providerNativeId: this.nativeId,
                    name: doorRange.doorMaxNo > 1 ? `${this.name} (Door Lock ${doorNo})` : `${this.name} (Door Lock)`,
                    nativeId: lockNativeId,
                    info: {
                        ...this.info,
                    },
                    interfaces: [
                        ScryptedInterface.Lock,
                        ScryptedInterface.Readme
                    ],
                    type: ScryptedDeviceType.Lock,
                };
                devices.push (lockDevice);
            }
        } catch (error) {
            this.console.error (`Failed to get door capabilities: ${error}`);
            // Fallback to single lock device
            const lockNativeId = `${this.nativeId}-lock-1`;
            const lockDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} (Door Lock)`,
                nativeId: lockNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.Lock,
                    ScryptedInterface.Readme
                ],
                type: ScryptedDeviceType.Lock,
            };
            devices.push (lockDevice);
        }
        
        return devices;
    }

    private async createEntrySensorDevices(): Promise<Device[]>
    {
        const devices: Device[] = [];
        
        try 
        {
            const client = this.getClient();
            const doorRange = await client.getDoorControlCapabilities();
            
            for (let doorNo = doorRange.doorMinNo; doorNo <= doorRange.doorMaxNo; doorNo++) {
                const sensorNativeId = `${this.nativeId}-entry-${doorNo}`;
                const sensorDevice: Device = {
                    providerNativeId: this.nativeId,
                    name: doorRange.doorMaxNo > 1 ? `${this.name} (Contact Sensor ${doorNo})` : `${this.name} (Contact Sensor)`,
                    nativeId: sensorNativeId,
                    info: {
                        ...this.info,
                    },
                    interfaces: [
                        ScryptedInterface.BinarySensor,
                        ScryptedInterface.Readme
                    ],
                    type: ScryptedDeviceType.Sensor,
                };
                devices.push (sensorDevice);
            }
        } catch (error) {
            this.console.error (`Failed to get door capabilities: ${error}`);
            // Fallback to single entry sensor device
            const sensorNativeId = `${this.nativeId}-entry-1`;
            const sensorDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} (Contact Sensor)`,
                nativeId: sensorNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.BinarySensor,
                    ScryptedInterface.Readme
                ],
                type: ScryptedDeviceType.Sensor,
            };
            devices.push (sensorDevice);
        }
        
        return devices;
    }


    async getDevice (nativeId: string): Promise<any>
    {
        if (nativeId.includes ('-lock-')) {
            let lock = this.locks.get (nativeId);
            if (!lock) {
                // Extract door number from nativeId (format: deviceId-lock-doorNo)
                const doorNo = nativeId.split ('-lock-')[1];
                lock = new HikvisionLock (this, nativeId, doorNo);
                this.locks.set (nativeId, lock);
            }
            return lock;
        }
        if (nativeId.includes ('-entry-')) {
            let entrySensor = this.entrySensors.get (nativeId);
            if (!entrySensor) {
                // Extract door number from nativeId (format: deviceId-entry-doorNo)
                const doorNo = nativeId.split ('-entry-')[1];
                entrySensor = new HikvisionEntrySensor (this, nativeId, doorNo);
                this.entrySensors.set (nativeId, entrySensor);
            }
            return entrySensor;
        }
        if (nativeId.endsWith ('-alert')) {
            this.tamperAlert ||= new HikvisionTamperAlert (this, nativeId);
            return this.tamperAlert;
        }
        return super.getDevice (nativeId);
    }

    async releaseDevice (id: string, nativeId: string)
    {
        if (nativeId.includes ('-lock-'))
            this.locks.delete (nativeId);
        else if (nativeId.includes ('-entry-'))
            this.entrySensors.delete (nativeId);
        else if (nativeId.endsWith ('-alert'))
            delete this.tamperAlert;
        else
            return super.releaseDevice (id, nativeId);
    }

    override async putSetting(key: string, value: string) {
        this.detectedChannels = undefined;
        this.eventApi?.destroy();
        this.eventApi = undefined;
        (this.client as HikvisionDoorbellAPI)?.destroy();
        this.client = undefined;
        
        // Clear cached video channels to force refresh from device
        this.storage.removeItem ('channelsJSON');

        // remove 0 port for autoselect port number
        if (key === SIP_SERVER_PORT_KEY && value === '0') { 
            value = '';
        }

        if (key === 'debug') {
            // Handle both string and boolean values
            const debugEnabled = typeof value === 'boolean' ? value : value === 'true';
            this.debugController?.setDebugEnabled(debugEnabled);
        }

        super.putSetting(key, value);

        this.updateSip();
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

    override async getOtherSettings(): Promise<Setting[]> 
    {
        const ret = await super.getOtherSettings();

        // Remove existing providedDevices entry if it exists
        const existingIndex = ret.findIndex(setting => setting.key === PROVIDED_DEVICES_KEY);
        if (existingIndex !== -1) {
            ret.splice(existingIndex, 1);
        }
        const providedDevices = JSON.parse(this.storage.getItem(PROVIDED_DEVICES_KEY) || '[]') as string[];
        ret.unshift(
            {
                key: PROVIDED_DEVICES_KEY,
                subgroup: 'Advanced',
                title: 'Provided devices',
                description: 'Additional devices provided by this doorbell',
                value: providedDevices,
                choices: [
                    'Locks',
                    'Contact Sensors',
                    'Tamper Alert',
                ],
                multiple: true,
            }
        );

        ret.unshift(
            {
                title: 'SIP Mode',
                value: `<p>Setting up a way to interact with the doorbell in order to receive calls. 
                Read more about how in this device description.</p>
                <p><b>Warning: Be careful! Switch to "Emulated SIP Proxy" mode leads to automatic configuration of settings on the doorbell device.</b></p>
                `,
                type: 'html',
                readonly: true,
            },
            {
                key: SIP_MODE_KEY,
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
        );

        return ret;
    }


    override async takeSmartCameraPicture (options?: RequestPictureOptions): Promise<MediaObject>
    {
        const api: HikvisionDoorbellAPI = this.getClient();
        
        // Get target resolution from options or use stream metadata
        let targetWidth = options?.picture?.width;
        let targetHeight = options?.picture?.height;
        
        // If no specific resolution requested, use main stream resolution to ensure correct aspect ratio
        if (!targetWidth || !targetHeight) {
            try {
                const streams = await this.getConstructedVideoStreamOptions();
                if (streams?.[0]?.video) {
                    targetWidth = streams[0].video.width;
                    targetHeight = streams[0].video.height;
                    this.console.debug (`Using stream resolution for snapshot: ${targetWidth}x${targetHeight}`);
                }
            } catch (error) {
                this.console.warn (`Failed to get stream resolution for snapshot: ${error}`);
            }
        }
        
        return mediaManager.createMediaObject (await api.jpegSnapshot (this.getRtspChannel(), options?.timeout, targetWidth, targetHeight), 'image/jpeg');
    }

    override async startIntercom(media: MediaObject): Promise<void> 
    {
        // Simple debounce protection
        if (this.intercomBusy) {
            this.console.debug ('Intercom busy, ignoring start request');
            return;
        }

        this.intercomBusy = true;
        this.console.debug ('Starting intercom');
        
        let channel: string = '1';
        let sipAudioTarget: SipAudioTarget | undefined;
        
        try 
        {
            await this.stopRing();
            
            channel = this.getRtspChannel() || '1';

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

            // Set codec for SIP manager
            if (this.sipManager) {
                this.sipManager.audioCodec = codec;
                // Invite if needed
                await this.sipManager.invite();
            }

            const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
            const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

            // Check if we have SIP audio target
            sipAudioTarget = this.sipManager?.remoteAudioTarget;
            
            if (!sipAudioTarget) {
                // Use HTTP method with switcher
                const session = await this.switchHttpSession (true);
                if (!session) {
                    throw new Error ('Failed to initialize HTTP session');
                }
            } else {
                this.console.info (`Using SIP RTP target: ${sipAudioTarget.ip}:${sipAudioTarget.port}`);
            }

            // Kill previous forwarder if exists
            if (this.activeIntercom && !this.activeIntercom.killed) {
                this.activeIntercom.kill();
            }
            
            // Configure audio track based on mode (SIP or HTTP)
            let audioTrack;
            if (sipAudioTarget) {
                // Initialize switcher if not exists
                if (!this.rtpStreamSwitcher) {
                    this.rtpStreamSwitcher = new RtpStreamSwitcher (this.console);
                }
                
                // Set initial target
                this.rtpStreamSwitcher.switchTarget (sipAudioTarget.ip, sipAudioTarget.port);
                
                // Create audio track with switcher enabled
                audioTrack = this.createSipAudioTrack (codec, true);
            } else {
                // HTTP mode needs buffer accumulation, write to switcher
                let available = Buffer.alloc (0);
                audioTrack = {
                    onRtp: (rtp: Buffer) => {
                        const parsed = RtpPacket.deSerialize (rtp);
                        available = Buffer.concat ([available, parsed.payload]);
                        if (available.length > 1024) {
                            const data = available.subarray (0, 1024);
                            // Write to switcher instead of directly to passthrough
                            this.httpStreamSwitcher?.write (data);
                            available = available.subarray (1024);
                        }
                    },
                    codecCopy: codec,
                    encoderArguments: [
                        '-ar', '8000',
                        '-ac', '1',
                        '-acodec', codec,
                    ]
                };
            }

            const forwarder = this.activeIntercom = await startRtpForwarderProcess (
                this.console, 
                ffmpegInput, 
                { audio: audioTrack }
            );

            // Setup PUT promise handlers for initial session after forwarder is created
            // so when calling we need this.activeIntercom to be populated
            // Only for HTTP mode (switcher has the putPromise)
            if (!sipAudioTarget && this.httpStreamSwitcher) {
                const currentSession = this.httpStreamSwitcher.getCurrentSession();
                if (currentSession) {
                    this.setupPutPromiseHandlers (currentSession.putPromise);
                }
            }

            // Single cleanup
            forwarder.killPromise.finally (() => {
                // Only cleanup if this is still the active forwarder
                if (this.activeIntercom === forwarder) 
                {
                    this.console.debug ('Audio finished, cleaning up');
                    try {
                        // HTTP mode cleanup - close current active session (not captured sessionId)
                        if (!sipAudioTarget && this.httpStreamSwitcher) {
                            const currentSessionId = this.httpStreamSwitcher.getCurrentSessionId();
                            if (currentSessionId) {
                                this.getClient().closeTwoWayAudio (channel, currentSessionId);
                                this.console.debug (`Closed HTTP session ${currentSessionId} on forwarder finish`);
                            }
                        }
                    } catch (e) {
                        // Ignore if already ended
                    }
                    
                    // Reset state without calling stopIntercom recursively
                    this.activeIntercom = undefined;
                } else {
                    this.console.debug ('Old forwarder finished, ignoring cleanup (new forwarder is active)');
                }
            });
        } catch (error) {
            // Reset state on error
            if (!sipAudioTarget && this.httpStreamSwitcher) {
                const currentSessionId = this.httpStreamSwitcher.getCurrentSessionId();
                if (currentSessionId) {
                    try {
                        await this.getClient().closeTwoWayAudio (channel, currentSessionId);
                    } catch (e) {
                        this.console.warn (`Failed to close HTTP session ${currentSessionId} on error:`, e);
                    }
                }
            }
            this.intercomBusy = false;
            throw error;
        }
    }

    override async stopIntercom(): Promise<void> 
    {
        // Queue stopIntercom calls to ensure sequential execution
        const stopPromise = this.stopIntercomQueue.then (async () => {
            if (!this.intercomBusy) {
                this.console.debug ('Intercom not active, ignoring stop request');
                return;
            }

            this.console.debug ('Stopping intercom');
            
            // Clear grace period if active
            this.clearGracePeriod();
            
            try 
            {
                // Kill the forwarder if exists
                if (this.activeIntercom && !this.activeIntercom.killed) {
                    this.activeIntercom.kill();
                }
                this.activeIntercom = undefined;

                // Cleanup stream switchers
                if (this.rtpStreamSwitcher) {
                    this.rtpStreamSwitcher.destroy();
                    this.rtpStreamSwitcher = undefined;
                }

                if (this.sipManager) {
                    await this.sipManager.hangup();
                }
                else {
                    // ISAPI mode: close HTTP session if active
                    const currentSessionId = this.httpStreamSwitcher?.getCurrentSessionId();
                    if (currentSessionId) {
                        const channel = this.getRtspChannel() || '1';
                        try {
                            await this.getClient().closeTwoWayAudio (channel, currentSessionId);
                            this.console.debug (`Closed HTTP session ${currentSessionId}`);
                        } catch (e) {
                            this.console.warn (`Failed to close HTTP session ${currentSessionId}:`, e);
                        }
                    }
                    
                    await this.getClient().hangUpCall();
                }
                
                // Destroy HTTP stream switcher after closing session
                if (this.httpStreamSwitcher) {
                    this.httpStreamSwitcher.destroy();
                    this.httpStreamSwitcher = undefined;
                }
            } finally {
                // Always reset state
                this.intercomBusy = false;
            }
        });

        // Update queue to continue after this request (success or failure)
        this.stopIntercomQueue = stopPromise.catch (() => {
            // Swallow errors in the queue chain to prevent blocking subsequent calls
        });

        return stopPromise;
    }

    private createEventApi(): HikvisionDoorbellAPI
    {
        return new HikvisionDoorbellAPI (
            this.getIPAddress(), 
            this.getHttpPort(), 
            this.getUsername(), 
            this.getPassword(), 
            this.isCallPolling(),
            this.console,
            this.storage
        );
    }

    private async stopRing()
    {
        if (!this.binaryState) return;

        if (this.sipManager)
        {
            try {
                await this.sipManager.answer();
            } catch (error) {
                this.console.error (`Stop SIP ringing error: ${error}`);
            }
        }
        else {
            await this.getClient().hangUpCall(); 
        }
    }

    /// Installs fake SIP settings on physical device automatically
    /// when SIP Proxy mode is enabled
    private installSipSettingsOnDeviceTimeout: NodeJS.Timeout;
    private async installSipSettingsOnDevice()
    {
        clearTimeout (this.installSipSettingsOnDeviceTimeout);
        if (this.getSipMode() === SipMode.Server
            && this.sipManager) 
        {
            const ip = this.sipManager.localIp;
            const port = this.sipManager.localPort;
            const roomNumber = this.storage.getItem (SIP_SERVER_ROOM_NUMBER_KEY) || DEFAULT_ROOM_NUMBER;
            const proxyPhone = this.storage.getItem (SIP_SERVER_PROXY_PHONE_KEY) || DEFAULT_PROXY_PHONE;
            const doorbellPhone = this.storage.getItem (SIP_SERVER_DOORBELL_PHONE_KEY) || DEFAULT_DOORBELL_PHONE;
            const buttonNumber = this.storage.getItem (SIP_SERVER_BUTTON_NUMBER_KEY) || DEFAULT_BUTTON_NUMBER;
            
            try {
                await this.getClient().setFakeSip (ip, port, roomNumber, proxyPhone, doorbellPhone, buttonNumber)
                this.console.info (`Installed fake SIP settings on doorbell. Address: ${ip}, port: ${port}, room: ${roomNumber}, proxy phone: ${proxyPhone}, doorbell phone: ${doorbellPhone}, button: ${buttonNumber}`);
            } catch (e) {
                this.console.error (`Error installing fake SIP settings: ${e}`);
                // repeat if unreached
                this.installSipSettingsOnDeviceTimeout = setTimeout (() => this.installSipSettingsOnDevice(), UNREACHED_RETRY_SEC * 1000);
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
                    {
                        subgroup: 'Connect to SIP Proxy',
                        key: SIP_SERVER_DOORBELL_PHONE_KEY,
                        title: 'Doorbell Caller ID',
                        description: 'Caller ID (Phone number) that will represent the doorbell',
                        value: this.storage.getItem (SIP_SERVER_DOORBELL_PHONE_KEY),
                        type: 'integer',
                        placeholder: DEFAULT_DOORBELL_PHONE
                    },
                ];
        
            case SipMode.Server:
                return [
                    {
                        subgroup: 'Emulate SIP Proxy',
                        title: 'Information',
                        description: '',
                        value: `<p>SIP proxy is emulated on this plugin. 
                        It allows intercepting and handling SIP calls from the doorbell device.
                        It is used for SIP call control and monitoring. 
                        It is not related to SIP telephony.</p>
                        <p><b>Enabling this mode will automatically configure the necessary settings on the doorbell device!</b></p>`,
                        type: 'html',
                        readonly: true,
                    },
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
                        key: SIP_SERVER_ROOM_NUMBER_KEY,
                        title: 'Room Number',
                        description: 'Room number to be configured on the doorbell device. Must be between 1 and 9999. This room number will represent this fake SIP proxy',
                        value: this.storage.getItem (SIP_SERVER_ROOM_NUMBER_KEY),
                        type: 'integer',
                        placeholder: DEFAULT_ROOM_NUMBER
                    },
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: SIP_SERVER_PROXY_PHONE_KEY,
                        title: 'SIP Proxy Phone Number',
                        description: 'Phone number that will represent this fake SIP proxy',
                        value: this.storage.getItem (SIP_SERVER_PROXY_PHONE_KEY),
                        type: 'integer',
                        placeholder: DEFAULT_PROXY_PHONE
                    },
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: SIP_SERVER_DOORBELL_PHONE_KEY,
                        title: 'Doorbell Phone Number',
                        description: 'Phone number that will represent the doorbell',
                        value: this.storage.getItem (SIP_SERVER_DOORBELL_PHONE_KEY),
                        type: 'integer',
                        placeholder: DEFAULT_DOORBELL_PHONE
                    },
                    {
                        subgroup: 'Emulate SIP Proxy',
                        key: SIP_SERVER_BUTTON_NUMBER_KEY,
                        title: 'Button Number',
                        description: 'Number of the call button. Used when doorbell has multiple call buttons. Must be between 1 and 99.',
                        value: this.storage.getItem (SIP_SERVER_BUTTON_NUMBER_KEY),
                        type: 'integer',
                        placeholder: DEFAULT_BUTTON_NUMBER
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
            callId: this.storage.getItem (SIP_CLIENT_CALLID_KEY) || '',
            doorbellId: this.storage.getItem (SIP_SERVER_DOORBELL_PHONE_KEY) || DEFAULT_DOORBELL_PHONE
          }
    }

    private configureSipHandlers()
    {
        const sipMode = this.getSipMode();
        const mng = this.sipManager;
        if (sipMode !== SipMode.Off && mng)
        {
            // Use SIP for invite detection
            this.console.debug ('Using SIP for invite detection');
            
            mng.setOnInviteHandler (async () => {
                this.console.debug (`SIP INVITE received`);
                
                // Check if we're waiting for reconnection during grace period
                if (this.waitingForReconnect && this.activeIntercom) 
                {
                    this.console.info ('(SIP) Received INVITE during grace period, attempting seamless reconnection');
                    
                    // Clear grace period timer
                    this.clearGracePeriod();
                    
                    // Accept the new invite
                    try {
                        await mng.answer();
                        
                        // Get new audio target from SIP manager
                        if (mng.remoteAudioTarget) 
                        {
                            
                            // Switch to new audio target
                            const switched = await this.switchAudioTarget();
                            if (!switched) {
                                this.console.error ('Failed to switch audio target, stopping intercom');
                                await this.stopIntercom();
                                return;
                            }
                        } 
                        else 
                        {
                            this.console.warn ('No audio target in new INVITE, stopping intercom');
                            await this.stopIntercom();
                            return;
                        }
                        
                        this.console.info ('Seamless reconnection successful');
                    } catch (error) {
                        this.console.error ('Failed to accept INVITE during reconnection:', error);
                        // Fallback: stop intercom
                        await this.stopIntercom();
                    }
                    return;
                }
                
                if (this.activeIntercom) 
                {
                    this.console.debug ('(SIP) Doorbell is busy, ignore invite');
                    return;
                }
                this.binaryState = true;
            });

            mng.setOnStopRingingHandler (() => {
                this.console.debug ('SIP stop ringing');
                this.binaryState = false;
            });
            
            mng.setOnHangupHandler (async () => {
                this.console.debug ('SIP BYE received');
                
                // Check if intercom is active
                if (this.activeIntercom && !this.activeIntercom.killed) 
                {
                    this.console.info ('Intercom is active, starting grace period for reconnection');
                    
                    // Clear any existing timer
                    this.clearGracePeriod();
                    
                    // Set flag that we're waiting for reconnection
                    this.waitingForReconnect = true;
                    
                    // Start grace period timer
                    this.gracePeriodTimer = setTimeout (() => {
                        this.attemptSipReconnection();
                    }, GRACE_PERIOD_SEC * 1000);
                    
                    this.console.debug (`Waiting ${GRACE_PERIOD_SEC}s for potential reconnection`);
                } else {
                    // No active intercom, just stop normally
                    await this.stopIntercom();
                }
            });

            return;
        }
        // Use polling for invite detection
        this.console.debug ('Using call status polling for invite detection');
    }

    private isCallPolling(): boolean {
        return this.getSipMode() === SipMode.Off;
    }
}

export class HikvisionDoorbellProvider extends RtspProvider
{
    static CAMERA_NATIVE_ID_KEY: string = 'cameraNativeId';

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

    override createCamera(nativeId: string) {
        return new HikvisionCameraDoorbell(nativeId, this);
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
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
                subgroup: 'Advanced',
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80.',
                placeholder: '80',
            },
            {
                subgroup: 'Advanced',
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    override async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate?.toString() === 'true';
        let twoWayAudio: string;
        if (!skipValidate) {
            const api = new HikvisionDoorbellAPI(
                `${settings.ip}`, 
                `${settings.httpPort || '80'}`,
                 username, 
                 password, 
                 false,
                 this.console, 
                 this.storage
                );
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
}

export default new HikvisionDoorbellProvider();
