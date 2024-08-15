import { HikvisionCameraAPI } from "../../hikvision/src/hikvision-camera-api"
import { HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { Readable, PassThrough } from 'stream';
import { MediaStreamOptions } from '@scrypted/sdk';
import net, { Server } from 'net';
import { AddressInfo } from 'net';
import { Destroyable } from "../../rtsp/src/rtsp";
import { EventEmitter } from 'events';
import { getDeviceInfo } from './probe';
import { AuthRequestOptions, AuthRequst, AuthRequestBody } from './auth-request'
import { OutgoingHttpHeaders } from 'http';
import { localServiceIpAddress } from './utils';
import libip from 'ip';
import xml2js from 'xml2js';

const isapiEventListenerID: String = "1"; // Other value than '1' does not work in KV6113
const messagePrefixSize = 692;

export enum HikvisionDoorbellEvent {
    Motion = '00000000',
    CaseTamperAlert = '02000000',
    TalkInvite = "11000000",
    TalkHangup = "12000000",
    Unlock = '01000000',
    DoorOpened = '06000000',
    DoorClosed = '05000000'
} 

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
    private address: string;

    constructor(address: string, public port: string, username: string, password: string, public console: Console, public storage: Storage) 
    {
        let endpoint = libip.isV4Format(address) ? `${address}:${port}` : `[${address}]:${port}`;
        super (endpoint, username, password, console);
        this.address = address;
        this.endpoint = endpoint;
        this.auth = new AuthRequst(username, password, console);
    }

    destroy(): void 
    {
        this.listener?.destroy();
        this.eventServer?.close();
    }

    override async request(urlOrOptions: string | HttpFetchOptions<Readable>, body?: AuthRequestBody) {

        let url: string = urlOrOptions as string;
        let opt: AuthRequestOptions;
        if (typeof urlOrOptions !== 'string') {
            url = urlOrOptions.url as string;
            if (typeof urlOrOptions.url !== 'string') {
                url = (urlOrOptions.url as URL).toString();
            }
            opt = {
                method: urlOrOptions.method,
                responseType: urlOrOptions.responseType || 'buffer',
                headers: urlOrOptions.headers as OutgoingHttpHeaders
            }
        }

        return await this.auth.request(url, opt, body);
    }

    override async getDeviceInfo() {
        return getDeviceInfo (this.auth, this.endpoint);
    }

    override async checkTwoWayAudio() {
        const response = await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`,
            responseType: 'text',
        });

        return response.body.includes('audioCompressionType');
    }

    override async putVcaResource(channel: string, resource: 'smart' | 'facesnap' | 'close') {
        // this feature is not supported by the doorbell 
        // and we return true to prevent the device from rebooting
        return true;
    }

    emitEvent(eventName: string | symbol, ...args: any[]) {
        try {
            this.listener.emit(eventName, ...args);
        } catch (error) {
            setTimeout(() => this.listener.emit(eventName, ...args), 250);    
        }
    }

    override async listenEvents() {
        // support multiple cameras listening to a single stream 
        if (!this.listener) {

            await this.runHttpHostsListener();
            await this.installHttpHosts();

            this.listener = new HikvisionDoorbell_Destroyable( () => {
                this.listener = undefined;
            });
        }

        return this.listener;
    }
    
    async getVideoChannels(camNumber: string): Promise<Map<string, MediaStreamOptions>> 
    {
        let channels: MediaStreamOptions[];
        try {
            channels = await this.getCodecs(camNumber);
            this.storage.setItem('channelsJSON', JSON.stringify(channels));
        }
        catch (e) {
            const raw = this.storage.getItem('channelsJSON');
            if (!raw)
                throw e;
            channels = JSON.parse(raw);
        }
        const ret = new Map<string, MediaStreamOptions>();
        for (const streamingChannel of channels) {
            const channel = streamingChannel.id;
            ret.set(channel, streamingChannel);
        }

        return ret;
    }

    async twoWayAudioCodec(channel: string): Promise<string> {

        const parameters = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels`;
        const { body } = await this.request({
            url: parameters,
            responseType: 'text',
        });

        const parsedXml = await xml2js.parseStringPromise(body);
        for (const twoWayChannel of parsedXml.TwoWayAudioChannelList.TwoWayAudioChannel) {
            const [id] = twoWayChannel.id;
            if (id === channel)
                return twoWayChannel?.audioCompressionType?.[0];
        }
    }

    async openTwoWayAudio(channel: string, passthrough: PassThrough) {

        const open = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/open`;
        const { body } = await this.request({
            url: open,
            responseType: 'text',
            method: 'PUT',
        });
        this.console.log('two way audio opened', body);

        const url = `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/audioData`;
        this.console.log('posting audio data to', url);

        return this.request({
            url,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Connection': 'keep-alive',
                'Content-Length': '0' // it is important, this leads to send binary nochanked stream
            },
            method: 'PUT'
        }, passthrough);
    }

    async closeTwoWayAudio(channel: string) {

        await this.request({
            url: `http://${this.endpoint}/ISAPI/System/TwoWayAudio/channels/${channel}/close`,
            method: 'PUT',
            responseType: 'text',
        });
    }

    rtspUrlFor(endpoint: string, channelId: string, params: string): string {
        return `rtsp://${endpoint}/ISAPI/Streaming/channels/${channelId}/${params}`;
    }

    async openDoor() {
        this.console.info ('Open door lock runing')
        // const data = '<RemoteControlDoor><cmd>alwaysOpen</cmd></RemoteControlDoor>';
        const data = '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>';
        await this.request({
            url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/1`,
            method: 'PUT',
            responseType: 'readable',
        }, data);
    }

    async closeDoor() {
        this.console.info ('Close door lock runing')
        const data = '<RemoteControlDoor><cmd>resume</cmd></RemoteControlDoor>';
        await this.request({
            url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/1`,
            method: 'PUT',
            responseType: 'readable',
        }, data);
    }

    async stopRinging() {
        let resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"answer"}}');
        this.console.log(`(stopRinging) Answer return: ${resp.statusCode} - ${resp.body}`);
        resp = await this.request({
            url: `http://${this.endpoint}/ISAPI/VideoIntercom/callSignal?format=json`,
            method: 'PUT',
            responseType: 'text',
        }, '{"CallSignal":{"cmdType":"hangUp"}}');
        this.console.log(`(stopRinging) HangUp return: ${resp.statusCode} - ${resp.body}`);
    }

    async setFakeSip (enabled: boolean, ip: string = '127.0.0.1', port: number = 5060)
    {

        const data = '<SIPServer>' +
        '<id>1</id>' +
        '<localPort>5060</localPort>' +
        '<streamID>1</streamID>' +
        '<Standard>' +
        `<enabled>${enabled ? "true" : "false"}</enabled>` +
        `<proxy>${ip}</proxy>` +
        `<proxyPort>${port}</proxyPort>` +
        '<displayName>Doorbell</displayName>' +
        '<userName>fakeuser</userName>' +
        '<authID>10101</authID>' +
        '<password>fakepassword</password>' +
        '<expires>60</expires>' +
        '</Standard>' +
        '</SIPServer>';
        
        await this.request({
            url: `http://${this.endpoint}/ISAPI/System/Network/SIP/1`,
            method: 'PUT',
            responseType: 'readable',
        }, data);
    }

    async getDoorOpenDuration(): Promise<number> {

        let xml: string;
        try {
            const response = await this.request({
                url: `http://${this.endpoint}/ISAPI/AccessControl/Door/param/1`,
                responseType: 'text',
            });
            xml = response.body;
            this.storage.setItem('doorOpenDuration', xml);
        }
        catch (e) {
            xml = this.storage.getItem('doorOpenDuration');
            if (!xml)
                throw e;
        }
        const parsedXml = await xml2js.parseStringPromise(xml);
        const ret = Number (parsedXml.DoorParam?.openDuration?.[0]);
        return ret;
    }

    async installHttpHosts() {

        await this.deleteHttpHosts();

        let addr = this.eventServer.address() as AddressInfo;
        let address = addr.family == 'IPv4' ? 
        `<ipAddress>${addr.address}</ipAddress>` :
        `<ipv6Address>${addr.address}</ipv6Address>`;

        // Despite the fact that we ask device to send us VMD (video motion detection) events, using the HTTP protocol,
        // the device sends us ALL events using a protocol unknown to me, in an unknown form. This is annoying...
        // Thus, we have to receive events on a regular TCP server and parse them empirically
        // By the way, authorization doesn't work either :)
        const data = `<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">` +
        `<id>${isapiEventListenerID}</id>` +
        `<url>/</url>` +
        `<protocolType>HTTP</protocolType>` +
        `<parameterFormatType>XML</parameterFormatType>` +
        `<addressingFormatType>ipaddress</addressingFormatType>` +
        `${address}` +
        `<portNo>${addr.port}</portNo>` +
        `<userName>fakeuser</userName>` +
        `<password>fakepassword</password>` +
        `<httpAuthenticationMethod>MD5digest</httpAuthenticationMethod>` +
        `<eventType>VMD</eventType>` +
        `<eventMode>all</eventMode>` +
        `</HttpHostNotification>`;
        
        try {
            const result = await this.request({
                method: "POST",
                url: `http://${this.endpoint}/ISAPI/Event/notification/httpHosts`,
                responseType: 'text',
                headers: {
                    'Accept': '*/*'
                }
            }, data);
    
            this.console.log(`Install result: ${result.statusCode}`);
            
        } catch (error) {
            this.console.error(`Install error: ${error}`); 
            // we rethrows error for restarting of the installation process
            throw error;
        }
    }

    async  deleteHttpHosts() {
        try {
            await this.request({
                method: "DELETE",
                url: `http://${this.endpoint}/ISAPI/Event/notification/httpHosts/${isapiEventListenerID}`,
                responseType: 'text'
            });
        } catch (error) {
            this.console.log(`Delete error: ${error}`);
        }
    }

    async runHttpHostsListener() {

        if (this.eventServer) {
            return;
        }

        let server: Server = net.createServer((socket) => {
            
            if (socket.remoteAddress != this.address) {
                this.console.warn(`Unknown client connected from: ${socket.remoteAddress}:${socket.remotePort}. Close it.`);
                socket.destroy();
            }

            let buffer = Buffer.alloc(0);
            socket.on("data", (data) => {
                buffer = Buffer.concat([buffer, data]);
                if (buffer.length >= messagePrefixSize) {
                    socket.destroy();
                }
                // const strData = data.toString();
                // this.console.warn(`Received ${data.length}: ${strData}`);
                // const hexData = data.toString('hex');
                // this.console.warn(`Received in HEX: ${hexData}`);
            });
        
            socket.once("close", (hadError: boolean) => {
                this.console.debug(`Client disconnected ${ hadError ? "with error" : "" }`);
            
                if (buffer.byteLength >= messagePrefixSize) {
                    let data = buffer.subarray(0, messagePrefixSize);
                    this.processEvent(data);
                }
                buffer = undefined;
            });
        
            socket.on("error", (error) => {
                this.console.error(`Socket Error: ${error.message}`);

            });
        });

        let host = await localServiceIpAddress (this.address);

        let result = new Promise<void>((resolve, reject) => {
            server.on('listening', () =>  {
                const addr = server.address() as AddressInfo;
                this.console.info(`EventReceiver listening on: ${addr.address}:${addr.port}`);
                resolve();
            });

            server.on ('error', (e: NodeJS.ErrnoException) => {
                if (e.code === 'EADDRINUSE') {
                  this.console.error('Address in use, retrying...');
                  setTimeout(() => {
                    server.close();
                    server.listen();
                  }, 1000);
                }
                else {
                    server.close();
                    this.eventServer = undefined;
                    reject(e);
                }
            }); 

            server.on ('close', async () => {
                await this.deleteHttpHosts();
                this.emitEvent ('close');
            });
        });

        this.eventServer = server.listen(0,host);

        return result;
    }

    processEvent( data: Buffer) {
        this.console.debug ("Processing event from camera...");

        const cameraNumber = '1';
        const inactive = false;

        const model = data.toString('utf8', 0xC, 0x2C);
        const serial = data.toString('utf8', 0x2C, 0x5C);
        const marker = data.toString('hex', 0xB0, 0xB4);

        // this.console.debug (`Event string:\n${data.toString('hex')}`); 

        for (const [name, event] of Object.entries(HikvisionDoorbellEvent)) {
            if (marker == event) {
                this.emitEvent('event', event, cameraNumber, inactive);
                this.console.debug (`Camera event emited: "${name}"`);        
                return;
            }
        }

        this.console.info (`Unknown camera event: "${marker}"`);       
    }
}
