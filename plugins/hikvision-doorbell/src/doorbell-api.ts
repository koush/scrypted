import { HikvisionCameraAPI } from "../../hikvision/src/hikvision-camera-api"
import { HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { Readable, PassThrough } from 'stream';
import { MediaStreamOptions } from '@scrypted/sdk';
import { Server } from 'net';
import { Destroyable } from "../../rtsp/src/rtsp";
import { EventEmitter } from 'events';
import { getDeviceInfo } from './probe';
import { AuthRequestOptions, AuthRequst, AuthRequestBody } from './auth-request'
import { OutgoingHttpHeaders } from 'http';
import libip from 'ip';
import xml2js from 'xml2js';
import { HttpFetchResponse } from "@scrypted/server/src/fetch";


export enum HikvisionDoorbellEvent {
    Motion,
    CaseTamperAlert,
    TalkInvite,
    TalkHangup,
    TalkOnCall,
    Unlock,
    Lock,
    DoorOpened,
    DoorClosed,
    DoorAbnormalOpened,
    AccessDenied,
}

interface AcsEventInfo {
    major: number;
    minor: number;
    time: string;
    remoteHostAddr: string;
    mask: string;
    doorNo?: number;
}

interface AcsEventResponse {
    AcsEvent: {
        searchID: string;
        totalMatches: number;
        responseStatusStrg: string;
        numOfMatches: number;
        InfoList: AcsEventInfo[];
    };
} 

const maxEventAgeSeconds = 30; // Ignore events older than this many seconds
const callPollingIntervalSec = 1; // Call status polling interval in seconds
const alertTickTimeoutSec = 60; // Alert stream tick timeout in seconds

const EventCodeMap = new Map<string, HikvisionDoorbellEvent>([
    ['5,25', HikvisionDoorbellEvent.DoorOpened],
    ['5,26', HikvisionDoorbellEvent.DoorClosed], 
    ['5,92', HikvisionDoorbellEvent.DoorAbnormalOpened],
    ['1,3', HikvisionDoorbellEvent.Motion],
    ['1,1028', HikvisionDoorbellEvent.CaseTamperAlert],
    ['5,21', HikvisionDoorbellEvent.Unlock],
    ['5,9', HikvisionDoorbellEvent.AccessDenied],
    ['5,22', HikvisionDoorbellEvent.Lock],
]);


export function getChannel(channel: string) {
    return channel || '101';
}

export interface HikvisionCameraStreamSetup {
    videoCodecType: string;
    audioCodecType: string;
}

export class HikvisionDoorbell_Destroyable extends EventEmitter implements Destroyable {

    constructor(public onDesctroy?: () => void) {
        super();
    }

    destroy(): void {

        if (this.onDesctroy)
            this.onDesctroy();
    }
}

export class HikvisionDoorbellAPI extends HikvisionCameraAPI 
{
    endpoint: string;
    auth: AuthRequst;

    private eventServer?: Server;
    private listener?: Destroyable;
    private requestQueue: Promise<any> = Promise.resolve();
    private alertStream?: Readable;
    
    // Door control capabilities
    private doorMinNo: number = 1;
    private doorMaxNo: number = 1;
    private availableCommands: string[] = ['open', 'close', 'alwaysOpen', 'alwaysClose'];
    private capabilitiesLoaded: boolean = false;
    private loadCapabilitiesPromise: Promise<void> | null = null;

    // Call status polling control
    private useCallStatusPolling: boolean = true;

    // Alert stream health tracking
    private alertTick?: number;

    constructor (
        address: string, 
        public port: string, 
        username: string, 
        password: string, 
        callStatusPolling: boolean,
        public console: Console, 
        public storage: Storage
    )
    {
        let endpoint = libip.isV4Format(address) ? `${address}:${port}` : `[${address}]:${port}`;
        super (endpoint, username, password, console);
        this.endpoint = endpoint;
        this.auth = new AuthRequst (username, password, console);
        
        // Initialize door capabilities
        this.initializeDoorCapabilities();
        this.useCallStatusPolling = callStatusPolling;
    }

    destroy(): void 
    {
        this.listener?.destroy();
        this.eventServer?.close();
        this.stopAlertStream();
    }

    override async request (urlOrOptions: string | HttpFetchOptions<Readable>, body?: AuthRequestBody)
    {
        // Create a promise for this specific request to prevent queue blocking
        const requestPromise = this.requestQueue.then(async () => {
            let url: string = urlOrOptions as string;
            let opt: AuthRequestOptions | undefined;
            if (typeof urlOrOptions !== 'string') {
                url = urlOrOptions.url as string;
                if (typeof urlOrOptions.url !== 'string') {
                    url = (urlOrOptions.url as URL).toString();
                }
                opt = {
                    method: urlOrOptions.method,
                    responseType: urlOrOptions.responseType || 'buffer',
                    headers: urlOrOptions.headers as OutgoingHttpHeaders,
                };
            }

            // Safety fallback and attach debug id
            if (!opt) {
                opt = { responseType: 'buffer' } as AuthRequestOptions;
            }

            return await this.auth.request(url, opt, body);
        });

        // Update the queue to continue after this request (success or failure)
        // This prevents failed requests from blocking the entire queue
        this.requestQueue = requestPromise.catch(() => {
            // Swallow errors in the queue chain to prevent blocking subsequent requests
            // The actual error is still propagated to the caller via requestPromise
        });

        return requestPromise;
    }

    override async getDeviceInfo() {
        return getDeviceInfo (this.auth, this.endpoint);
    }

    override async checkTwoWayAudio()
    {
        const response = await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`,
            responseType: 'text',
        });

        return response.body.includes('audioCompressionType');
    }

    override async putVcaResource (channel: string, resource: 'smart' | 'facesnap' | 'close')
    {
        // this feature is not supported by the doorbell 
        // and we return true to prevent the device from rebooting
        return true;
    }

    override async jpegSnapshot (channel: string, timeout = 10000, width?: number, height?: number): Promise<Buffer>
    {
        let url = `http://${this.endpoint}/ISAPI/Streaming/channels/${getChannel (channel)}/picture?snapShotImageType=JPEG`
        
        // Add optional resolution parameters
        if (width) {
            url += `&videoResolutionWidth=${width}`;
        }
        if (height) {
            url += `&videoResolutionHeight=${height}`;
        }

        const response = await this.request ({
            url: url,
            timeout,
        });

        return response.body;
    }

    emitEvent (eventName: string | symbol, ...args: any[])
    {
        try {
            this.listener.emit(eventName, ...args);
        } catch (error) {
            this.console.warn(`Event emission failed, retrying in 250ms: ${error}`);
            setTimeout(() => {
                if (this.listener) {
                    try {
                        this.listener.emit(eventName, ...args);
                    } catch (retryError) {
                        this.console.error(`Event emission retry failed: ${retryError}`);
                    }
                }
            }, 250);    
        }
    }

    override async listenEvents()
    {
        // support multiple cameras listening to a single stream 
        if (!this.listener) 
        {
            // Load device timezone before starting event polling
            try {
                await this.getDeviceTimezone();
                this.console.info ('Device timezone loaded successfully');
            } catch (error) {
                this.console.warn (`Failed to load device timezone, using UTC fallback: ${error}`);
            }
    
            await this.listenAlertStream();
            this.console.info ('Using alert stream for events');

            if (this.useCallStatusPolling) {
                this.startCallStatusPolling();
                this.console.info ('Call status polling started');
            } else {
                this.console.info ('Call status polling disabled (using SIP)');
            }

            this.listener = new HikvisionDoorbell_Destroyable (() => {
                this.listener = undefined;
                
                // Check if alert stream tick occurred more than timeout
                if (this.alertTick) {
                    const timeSinceLastTick = Date.now() - this.alertTick;
                    const timeoutMs = alertTickTimeoutSec * 1000;
                    
                    if (timeSinceLastTick > timeoutMs) {
                        this.console.info (`Alert stream last tick ${(timeSinceLastTick / 1000).toFixed (1)}s ago, stopping alert stream`);
                        this.stopAlertStream();
                    } else {
                        this.console.debug (`Alert stream last tick ${(timeSinceLastTick / 1000).toFixed (1)}s ago, keeping alert stream active`);
                    }
                }
                
                this.stopCallStatusPolling();
            });
        }
    
        return this.listener;
    }
    
    async getVideoChannels (camNumber: string): Promise<Map<string, MediaStreamOptions>>
    {
        let channels: MediaStreamOptions[];
        try {
            channels = await this.getCodecs (camNumber);
            this.console.info (`Video channels from device: ${JSON.stringify (channels)}`);
            this.storage.setItem ('channelsJSON', JSON.stringify (channels));
        }
        catch (e) {
            const raw = this.storage.getItem ('channelsJSON');
            if (!raw)
                throw e;
            channels = JSON.parse (raw);
            this.console.warn (`Using cached video channels: ${raw}`);
        }
        const ret = new Map<string, MediaStreamOptions>();
        for (const streamingChannel of channels) {
            const channel = streamingChannel.id;
            ret.set (channel, streamingChannel);
        }

        return ret;
    }

    async twoWayAudioCodec (channel: string): Promise<string>
    {

        const parameters = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`;
        const { body } = await this.request({
            url: parameters,
            responseType: 'text',
        });

        const parsedXml = await xml2js.parseStringPromise (body);
        for (const twoWayChannel of parsedXml.TwoWayAudioChannelList.TwoWayAudioChannel) {
            const [id] = twoWayChannel.id;
            if (id === channel)
                return twoWayChannel?.audioCompressionType?.[0];
        }
    }

    async openTwoWayAudio (channel: string, passthrough: PassThrough)
    {

        const open = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/open`;
        let response = await this.request({
            url: open,
            responseType: 'text',
            method: 'PUT',
        });
        
        // Check for error responses before proceeding
        const parsedXml = await this.checkResponseStatus (response, 'Open two-way audio');
        
        this.console.debug ('two way audio opened', response.body);

        // Extract sessionId from XML response
        let sessionId: string | undefined;
        if (parsedXml) 
        {
            sessionId = parsedXml.TwoWayAudioSession?.sessionId?.[0];
            if (sessionId) 
            {
                this.console.debug (`Extracted sessionId: ${sessionId}`);
            }
            else {
                this.console.debug ('No sessionId found in response');
            }
        }

        const url = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/audioData${sessionId ? `?sessionId=${sessionId}` : ''}`;
        this.console.debug ('Posting audio data to', url);

        // IMPORTANT: Use responseType 'readable' so AuthRequst does not wait for full body
        // and resolves on headers. Otherwise, a long-lived PUT keeps the queue blocked
        // and delays hangUp call behind this request.
        response = await this.request({
            url,
                responseType: 'readable',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Connection': 'keep-alive',
                'Content-Length': '0' // it is important, this leads to send binary nochanked stream
            },
            method: 'PUT'
        }, passthrough);

        const result = new Promise<HttpFetchResponse<any>> ((resolve, reject) => {
            const result: HttpFetchResponse<any> = response;
            result.body.on ('end', () => resolve(result));
            result.body.on ('error', () => reject(result));
        });
        return {
            sessionId,
            result
        }
    }

    async closeTwoWayAudio (channel: string, sessionId?: string)
    {

        const response = await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/close${sessionId ? `?sessionId=${sessionId}` : ''}`,
            method: 'PUT',
            responseType: 'text',
        });
        
        // Check for error responses before proceeding
        await this.checkResponseStatus (response, 'Close two-way audio');
        
        this.console.debug('Two way audio closed for channel', channel);
    }

    rtspUrlFor (endpoint: string, channelId: string, params: string): string {
        return `rtsp://${endpoint}/ISAPI/Streaming/channels/${channelId}/${params}`;
    }

    /**
     * Initialize door capabilities asynchronously
     */
    private async initializeDoorCapabilities()
    {
        try {
            await this.loadDoorCapabilities();
        } catch (error) {
            this.console.warn(`Failed to load door capabilities on initialization: ${error}`);
            // Use default values if capabilities loading fails
        }
    }

    /**
     * Load and parse door control capabilities with single-flight pattern
     * Ensures only one request is made even if called multiple times simultaneously
     */
    private async loadDoorCapabilities()
    {
        // If already loaded, return immediately
        if (this.capabilitiesLoaded) {
            return;
        }
        
        // If already loading, wait for the existing promise
        if (this.loadCapabilitiesPromise) {
            return this.loadCapabilitiesPromise;
        }
        
        // Start loading and store the promise
        this.loadCapabilitiesPromise = this.performCapabilitiesLoad();
        
        try {
            await this.loadCapabilitiesPromise;
        } finally {
            // Clear the promise when done (success or failure)
            this.loadCapabilitiesPromise = null;
        }
    }
    
    /**
     * Actual implementation of capabilities loading
     */
    private async performCapabilitiesLoad(): Promise<void>
    {
        try {
            const response = await this.request({
                url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/capabilities`,
                responseType: 'text',
            });
            
            this.console.debug('Door control capabilities XML:', response.body);
            
            // Parse XML to get structured data
            const parsedXml = await xml2js.parseStringPromise (response.body);
            
            // Extract door number range
            const doorNo = parsedXml.RemoteControlDoor?.doorNo?.[0];
            if (doorNo && doorNo.$) {
                this.doorMinNo = parseInt (doorNo.$.min) || 1;
                this.doorMaxNo = parseInt (doorNo.$.max) || 1;
            }
            
            // Extract available commands
            const cmd = parsedXml.RemoteControlDoor?.cmd?.[0];
            if (cmd && cmd.$.opt) {
                this.availableCommands = cmd.$.opt.split(',').map ((c: string) => c.trim());
            }
            
            this.capabilitiesLoaded = true;
            this.console.info (`Door capabilities loaded: doors ${this.doorMinNo}-${this.doorMaxNo}, commands: ${this.availableCommands.join (', ')}`);
            
        } catch (error) {
            this.console.error(`Failed to load door control capabilities: ${error}`);
            throw error;
        }
    }

    /**
     * Get the capability of remotely controlling the door
     * Returns XML_Cap_RemoteControlDoor structure with available door control options
     */
    async getDoorControlCapabilities()
    {
        if (!this.capabilitiesLoaded) {
            await this.loadDoorCapabilities();
        }
        
        return {
            doorMinNo: this.doorMinNo,
            doorMaxNo: this.doorMaxNo,
            availableCommands: this.availableCommands
        };
    }

    /**
     * Validate door number and command against capabilities
     */
    private validateDoorControl (doorNo: string, command: string): void
    {
        const doorNum = parseInt (doorNo);
        if (doorNum < this.doorMinNo || doorNum > this.doorMaxNo) {
            throw new Error(`Door number ${doorNo} is out of range. Valid range: ${this.doorMinNo}-${this.doorMaxNo}`);
        }
        
        if (!this.availableCommands.includes (command)) {
            throw new Error (`Command '${command}' is not supported. Available commands: ${this.availableCommands.join (', ')}`);
        }
    }

    /**
     * Control door remotely with supported door commands
     * @param doorNo - Door number (default: '1')
     * @param command - Door command (validated against device capabilities)
     */
    async controlDoor (
        doorNo: string = '1', 
        command: string = 'resume'
    )
    {
        // Ensure capabilities are loaded
        if (!this.capabilitiesLoaded) {
            await this.loadDoorCapabilities();
        }
        
        // Validate parameters against capabilities
        this.validateDoorControl (doorNo, command);
        this.console.info(`Controlling door ${doorNo} with command: ${command}`);
        
        let data = `<RemoteControlDoor>`;
        // data += `<doorNo>${doorNo}</doorNo>`;
        data += `<cmd>${command}</cmd>`;
        data += `</RemoteControlDoor>`;
        
        try {
            const response = await this.request({
                url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
                method: 'PUT',
                responseType: 'text',
            }, data);
            
            // Check for error responses before proceeding
            await this.checkResponseStatus (response, `Control door ${doorNo} with command '${command}'`);
            
            this.console.debug(`Door control response: ${response.statusCode} - ${response.body}`);
            return response;
        } catch (error) {
            this.console.error(`Failed to control door: ${error}`);
            throw error;
        }
    }

    async answerCall() 
    {
        const resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"answer"}}');
        this.console.debug (`(answer) Answer return: ${resp.statusCode} - ${resp.body}`);
    }

    async hangUpCall()
    {
        this.console.debug ('(hangUpCall) Starting hangUp request');
        const resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"hangUp"}}');
        this.console.debug (`(hangUpCall) HangUp return: ${resp.statusCode} - ${resp.body}`);
        return resp;
    }

    async cancelCall()
    {
        this.console.debug ('(cancelCall) Starting cancel request');
        const resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"cancel"}}');
        this.console.debug (`(cancelCall) Cancel return: ${resp.statusCode} - ${resp.body}`);
        return resp;
    }

    async rejectCall()
    {
        const resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"reject"}}');
        this.console.debug (`(reject) Reject return: ${resp.statusCode} - ${resp.body}`);
        return resp;
    }

    async setFakeSip (
        ip: string = '127.0.0.1', 
        port: number = 5060, 
        roomNumber: string, 
        proxyPhone: string, 
        doorbellPhone: string, 
        buttonNumber: string = '1'
    )
    {
        const data = '<SIPServer>' +
        '<id>1</id>' +
        `<localPort>${port}</localPort>` +
        '<streamID>1</streamID>' +
        '<Standard>' +
        '<enabled>true</enabled>' +
        `<proxy>${ip}</proxy>` +
        `<proxyPort>${port}</proxyPort>` +
        `<displayName>${doorbellPhone}</displayName>` +
        `<userName>${doorbellPhone}</userName>` +
        `<authID>${doorbellPhone}</authID>` +
        `<password>fakepassword</password>` +
        '<expires>60</expires>' +
        '</Standard>' +
        '</SIPServer>';
        
        this.console.debug (`Attempting SIP server configuration with data: ${data}`);
        
        const sipResponse = await this.request ({
            url: `http://${this.endpoint}/ISAPI/System/Network/SIP/1`,
            method: 'PUT',
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
                'Accept': 'application/xml'
            }
        }, data);
        
        this.console.debug (`SIP server configuration response: ${sipResponse.statusCode} - ${sipResponse.body}`);

        // Set phone number record for room
        const phoneNumberData = {
                "PhoneNumberRecord": {
                    "roomNo": roomNumber,
                    "PhoneNumbers": [
                        {
                            "phoneNumber": proxyPhone
                        }
                    ]
                }
            };

        try {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/VideoIntercom/PhoneNumberRecords?format=json`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                responseType: 'text',
            }, JSON.stringify (phoneNumberData));
                
            this.console.debug (`Phone number record set: ${response.body}`);
        }
        catch (e) {
            this.console.error ('Failed to set phone number record:', e);
        }

        // Set call button configuration
        const keyCfgData = `<?xml version="1.0" encoding="UTF-8"?><KeyCfg xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0"><id>${buttonNumber}</id><callNumber>${roomNumber}</callNumber><moduleId>1</moduleId><templateNo>0</templateNo></KeyCfg>`;

        try {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/VideoIntercom/keyCfg/${buttonNumber}`,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                responseType: 'text',
            }, keyCfgData);
                
            this.console.debug (`Call button ${buttonNumber} configured for room ${roomNumber}: ${response.body}`);
        }
        catch (e) {
            this.console.error (`Failed to configure call button ${buttonNumber}:`, e);
        }

        
    }

    async getDoorOpenDuration (doorNo: string = '1'): Promise<number>
    {
        // Ensure capabilities are loaded to validate door number
        if (!this.capabilitiesLoaded) {
            await this.loadDoorCapabilities();
        }
        
        // Validate door number against capabilities
        const doorNum = parseInt (doorNo);
        if (doorNum < this.doorMinNo || doorNum > this.doorMaxNo) {
            throw new Error (`Door number ${doorNo} is out of range. Valid range: ${this.doorMinNo}-${this.doorMaxNo}`);
        }
        
        let xml: string;
        const storageKey = `doorOpenDuration_${doorNo}`;
        
        try {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/AccessControl/Door/param/${doorNo}`,
                responseType: 'text',
            });
            xml = response.body;
            this.storage.setItem (storageKey, xml);
        }
        catch (e) {
            xml = this.storage.getItem (storageKey);
            if (!xml)
                throw e;
        }
        
        const parsedXml = await xml2js.parseStringPromise (xml);
        const ret = Number (parsedXml.DoorParam?.openDuration?.[0]);
        
        this.console.debug (`Door ${doorNo} open duration: ${ret} seconds`);
        return ret;
    }


    private callStatusInterval?: NodeJS.Timeout;
    private lastCallState: string = 'idle';
    private isCallPollingActive: boolean = false;
    
    // ACS event polling properties
    private acsEventPollingInterval?: NodeJS.Timeout;
    private lastAcsEventTime: Date = new Date();
    
    // Timezone properties
    private deviceTimezone?: string; // GMT offset in format like '+03:00'
    
    async getCallStatus(): Promise<string>
    {
        try {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/VideoIntercom/callStatus?format=json`,
                responseType: 'text',
            });
            
            const callData = JSON.parse (response.body);

            // this.console.debug (`Call status: ${JSON.stringify (callData)}`);

            const callState = callData.CallStatus?.status || 'idle';
            return callState;
        } catch (e) {
            this.console.error (`Failed to get call status: ${e}`);
            return 'idle';
        }
    }

    private startCallStatusPolling()
    {
        if (this.callStatusInterval || this.isCallPollingActive) {
            this.console.debug ('Call status polling is already active');
            return;
        }
        
        this.isCallPollingActive = true;
        this.console.info ('Starting call status polling');
        
        this.callStatusInterval = setInterval(async () => {
            try {
                const callState = await this.getCallStatus();
                
                if (callState !== this.lastCallState) {
                    this.console.info (`Call state changed: ${this.lastCallState} -> ${callState}`);
                    
                    if (callState === 'ring') {
                        this.console.debug ('Doorbell ringing detected via polling');
                        this.emitEvent ('event', HikvisionDoorbellEvent.TalkInvite);
                    } else if (callState === 'idle') {
                        this.console.debug ('Doorbell hangup detected via polling');
                        this.emitEvent ('event', HikvisionDoorbellEvent.TalkHangup);
                    } else if (callState === 'onCall') {
                        this.console.debug ('Doorbell on call detected via polling');
                        this.emitEvent ('event', HikvisionDoorbellEvent.TalkOnCall);
                    }
                    
                    this.lastCallState = callState;
                }
            } catch (e) {
                this.console.warn (`Call status polling error: ${e}`);
            }
        }, callPollingIntervalSec * 1000);
    }
    

    private stopCallStatusPolling()
    {
        if (this.callStatusInterval) {
            clearInterval (this.callStatusInterval);
            this.callStatusInterval = undefined;
            this.console.info ('Call status polling stopped');
        }
        this.isCallPollingActive = false;
    }

    /**
     * Get device timezone configuration
     * Parses CST format (e.g., CST-3:00:00) and converts to GMT offset (e.g., +03:00)
     * Note: CST prefix is abstract and sign must be inverted
     */
    private async getDeviceTimezone(): Promise<string>
    {
        try 
        {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/System/time/timeZone`,
                responseType: 'text',
            });
            
            this.console.debug (`Timezone XML response: ${response.body}`);
            
            // Parse XML to get timezone
            const parsedXml = await xml2js.parseStringPromise (response.body);
            const timezoneStr = parsedXml.Time?.timeZone?.[0];
            
            if (!timezoneStr) {
                throw new Error ('No timezone found in response');
            }
            
            // Parse CST format: CST-3:00:00 -> +03:00 (invert sign)
            const match = timezoneStr.match(/CST([+-])(\d{1,2}):(\d{2}):(\d{2})/);
            if (!match) {
                throw new Error (`Invalid timezone format: ${timezoneStr}`);
            }
            
            const [, sign, hours, minutes] = match;
            // Invert the sign as per requirement
            const invertedSign = sign === '-' ? '+' : '-';
            const gmtOffset = `${invertedSign}${hours.padStart (2, '0')}:${minutes}`;
            
            this.deviceTimezone = gmtOffset;
            
            this.console.info (`Device timezone loaded: ${timezoneStr} -> GMT${gmtOffset}`);
            return gmtOffset;
            
        } catch (error) {
            this.console.error (`Failed to get device timezone: ${error}`);
            // Fallback to system timezone if timezone detection fails
            const systemOffset = new Date().getTimezoneOffset();
            const offsetHours = Math.abs(Math.floor(systemOffset / 60));
            const offsetMinutes = Math.abs(systemOffset % 60);
            const sign = systemOffset <= 0 ? '+' : '-'; // getTimezoneOffset returns negative for positive offsets
            this.deviceTimezone = `${sign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
            this.console.info (`Using system timezone as fallback: GMT${this.deviceTimezone}`);
            return this.deviceTimezone;
        }
    }
    
    /**
     * Convert local device time to UTC using device timezone
     * @param localTimeStr - Local time string from device
     * @returns Date object in UTC
     */
    private convertDeviceTimeToUTC (localTimeStr: string): Date
    {
        if (!this.deviceTimezone) {
            // If timezone not loaded, use system timezone
            return new Date (localTimeStr);
        }
        
        try {
            // Add timezone to device time string and let JavaScript handle the conversion
            const dateWithTimezone = `${localTimeStr}${this.deviceTimezone}`;
            const date = new Date (dateWithTimezone);
            
            this.console.debug (`Converted device time: ${localTimeStr} + ${this.deviceTimezone} -> ${date.toISOString()}`);
            return date;
            
        } catch (error) {
            this.console.warn (`Failed to convert device time: ${error}`);
            return new Date (localTimeStr);
        }
    }

    /**
     * Get Access Control System events using polling method
     * Returns events in reverse chronological order (newest first)
     * @param maxResults - Maximum number of results to return (default: 20)
     * @param searchResultPosition - Starting position for search results (default: 0)
     * @param major - Major event type filter (0 = all, default: 0)
     * @param minor - Minor event type filter (0 = all, default: 0)
     */
    private async getAcsEvents (
        maxResults: number = 20,
        searchResultPosition: number = 0,
        major: number = 0,
        minor: number = 0
    ): Promise<AcsEventResponse>
    {
        const requestBody = {
            AcsEventCond: {
                searchID: '0',
                searchResultPosition,
                maxResults,
                major,
                minor,
                timeReverseOrder: true
            }
        };

        try {
            const response = await this.request ({
                url: `http://${this.endpoint}/ISAPI/AccessControl/AcsEvent?format=json`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                responseType: 'text',
            }, JSON.stringify (requestBody));

            // Ensure successful response before attempting to parse JSON
            if (response.statusCode !== 200) {
                throw new Error(`HTTP ${response.statusCode}`);
            }

            const eventData: AcsEventResponse = JSON.parse (response.body);
            // this.console.debug (`AcsEvent polling response: ${JSON.stringify (eventData, null, 2)}`);
            
            return eventData;
        } catch (error) {
            this.console.error (`Failed to get ACS events: ${error}`);
            throw error;
        }
    }

    /**
     * Process ACS event from polling response and emit corresponding doorbell events
     * @param eventInfo - Event information from ACS polling response
     */
    private processAcsEvent (eventInfo: AcsEventInfo): void
    {
        const eventKey = `${eventInfo.major},${eventInfo.minor}`;
        const doorbellEvent = EventCodeMap.get (eventKey);
        
        // Check if event is too old (ignore events older than maxEventAgeSeconds)
        if (eventInfo.time) {
            // Convert device local time to UTC using timezone
            const eventTime = this.convertDeviceTimeToUTC (eventInfo.time);
            const now = new Date();
            const ageInSeconds = (now.getTime() - eventTime.getTime()) / 1000;
            
            if (ageInSeconds > maxEventAgeSeconds) {
                this.console.debug (`Ignoring old ACS event: ${ageInSeconds.toFixed (1)}s old`);
                return;
            }
        }
        
        if (doorbellEvent !== undefined) {
            // Extract door number from event
            const doorNo = eventInfo.doorNo ? eventInfo.doorNo.toString() : '1';
            
            this.console.info (`ACS polling event detected: ${HikvisionDoorbellEvent[doorbellEvent]} (${eventKey}) door=${doorNo}`);
            this.emitEvent ('event', doorbellEvent, doorNo);
        } else {
            this.console.info (`Unknown ACS event: major=${eventInfo.major}, minor=${eventInfo.minor}`);
        }
    }

    /**
     * Poll for new ACS events and process them
     * This method can be called periodically to check for new events
     * @param lastEventTime - Optional timestamp to filter events newer than this time
     */
    private async pollAndProcessAcsEvents (lastEventTime?: Date): Promise<void>
    {
        try {
            const eventResponse = await this.getAcsEvents();
            let latestEventTime: Date | undefined;
            
            if (eventResponse.AcsEvent && eventResponse.AcsEvent.InfoList) {
                for (const eventInfo of eventResponse.AcsEvent.InfoList.reverse()) {
                    const eventTime = new Date (eventInfo.time);
                    
                    // Filter events by time if lastEventTime is provided
                    if (lastEventTime && eventTime <= lastEventTime) {
                        continue; // Skip events that are not newer
                    }
                    
                    this.processAcsEvent (eventInfo);
                    
                    // Track the latest event time
                    if (!latestEventTime || eventTime > latestEventTime) {
                        latestEventTime = eventTime;
                    }
                }
            }
            
            // Update the stored last event time if we found newer events
            if (latestEventTime) {
                this.lastAcsEventTime = latestEventTime;
                this.console.debug (`Updated last ACS event time to: ${latestEventTime.toISOString()}`);
            }
            
        } catch (error) {
            this.console.error (`Failed to poll and process ACS events: ${error}`);
            throw error;
        }
    }
    
    /**
     * Check HTTP status code and XML response for errors
     */
    private async checkResponseStatus (response: any, operation: string): Promise<any>
    {
        // First check HTTP status code
        let message: string | undefined;
        if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) 
        {
            message = `${operation} failed with HTTP status ${response.statusCode}`;
            this.console.error (message);
        }

        // Then check XML response body for error details
        const body = response.body;
        if (!body?.trim().startsWith ('<?xml')) {
            return; // Not XML response, skip XML check
        }

        try {
            const parsedXml = await xml2js.parseStringPromise (body);
            const responseStatus = parsedXml.ResponseStatus;
            
            if (responseStatus) {
                const statusCode = responseStatus.statusCode?.[0];
                const statusString = responseStatus.statusString?.[0];
                const errorMsg = responseStatus.errorMsg?.[0];
                
                if (statusCode && statusCode !== '1') { // Status code 1 means success
                    const errorDetails = errorMsg || statusString || `Status code: ${statusCode}`;
                    message = `${operation} failed: ${errorDetails}`;
                    this.console.error (message);
                }
            }
            if (message) {
                throw new Error (message);
            }
            return parsedXml;
        } catch (error) {
            if (error.message.includes ('failed:')) {
                throw error; // Re-throw our custom error
            }
            // If XML parsing fails, it might not be an error response, so continue
            this.console.debug (`Failed to parse XML response for error checking: ${error.message}`);
            return;
        }
    }

    /**
     * Listen for alert stream events
     * This method can be called to start listening for events
     */
    async listenAlertStream()
    {
        if (this.alertStream) {
            this.console.debug ('Alert stream already listening');
            return;
        }
        try 
        {
            const { body } = await this.request({
                url: `http://${this.endpoint}/ISAPI/Event/notification/alertStream`,
                responseType: 'readable',
                headers: {
                    'Accept': '*/*'
                }
            });
    
            const readable = body as Readable;
            let buffer = '';

            this.alertStream = readable;

            readable.on ('data', (chunk: Buffer) => {
                buffer += chunk.toString ('utf8');
                
                // Parse multipart boundary content
                const parts = buffer.split ('--MIME_boundary');
                buffer = parts.pop() || ''; // Keep incomplete part
                
                for (const part of parts) {
                    if (!part.trim()) continue;
                    
                    // Extract JSON from multipart section
                    const jsonMatch = part.match(/Content-Type: application\/json[^{]*(\{.*\})/s);
                    if (jsonMatch) {
                        try {
                            const eventData = JSON.parse (jsonMatch[1]);
                            this.processAlertStreamEvent (eventData);
                        } catch (pe) {
                            this.console.warn(`Failed to parse alertStream JSON: ${pe}`);
                        }
                    }
                }
            });
    
            readable.on ('error', (err) => {
                if (this.alertStream === readable) {
                    this.alertStream = undefined;
                }
                this.console.error (`alertStream error: ${err}`);
                this.emitEvent ('error', err);
            });
    
            readable.on ('close', () => {
                if (this.alertStream === readable) {
                    this.alertStream = undefined;
                }
                this.console.debug ('alertStream closed');
                this.emitEvent ('close');
            });
    
        } catch (err) {
            this.console.error (`listenAlertStream failed: ${err}`);
            throw err;
        }
    }

    /**
     * Stop alert stream listener
     */
    private stopAlertStream(): void
    {
        if (!this.alertStream) {
            return;
        }

        this.console.debug ('Stopping alert stream listener');
        const stream = this.alertStream;
        this.alertStream = undefined;
        stream.removeAllListeners();
        if (!stream.destroyed) {
            stream.destroy();
        }
    }

    processAlertStreamEvent (eventData: any)
    {
        const eventType = eventData.eventType || '';
    
        this.console.debug (`AlertStream event: ${eventType}`);

        // Check if event is too old (ignore events older than 30 seconds)
        if (eventData.dateTime) {
            const eventTime = new Date (eventData.dateTime);
            const now = new Date();
            const ageInSeconds = (now.getTime() - eventTime.getTime()) / 1000;
            
            if (ageInSeconds > maxEventAgeSeconds) {
                this.console.debug (`Ignoring old event: ${ageInSeconds.toFixed (1)}s old`);
                return;
            }
        }
    
        // Map JSON events to existing HikvisionDoorbellEvent enum
        if (eventType === 'videoloss') {
            // Track alert stream tick time
            this.alertTick = Date.now();
            return;
        }

        this.console.debug (`AlertStream JSON: ${JSON.stringify (eventData, null, 2)}`);
    
        this.pollAndProcessAcsEvents (this.lastAcsEventTime);
    }
}
