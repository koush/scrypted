import { HttpFetchResponse } from '../../../server/src/fetch/http-fetch'
import { AuthFetchCredentialState, HttpFetchOptions, HttpFetchResponseType, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { Readable, PassThrough } from 'stream';
import sdk from '@scrypted/sdk';
import { isLoopback, isV4Format, isV6Format } from 'ip';
import net, { Server } from 'net';
import crypto from 'crypto';
import { resolve } from 'path';
import { rejects } from 'assert';
import { AddressInfo } from 'net';
import { hostname } from 'os';
import { Socket } from 'dgram';
import { HikvisionCameraAPI, HikvisionCameraEvent } from "./hikvision-camera-api";
import ip from 'ip';
import { Destroyable } from "../../rtsp/src/rtsp";
import { EventEmitter } from 'events';
import { getDeviceInfo } from './probe';
import { AuthRequestOptions, AuthRequst, AuthRequestBody } from './auth-request'
import { IncomingMessage, OutgoingHttpHeaders } from 'http';

const isapiEventListenerID: String = "1"; // Other value than '1' does not work in KV6113
const messagePrefixSize = 692;

export enum HikvisionCameraEvent_KV6113 {
    Motion = '00000000',
    CaseBurglaryAlert = '02000000',
    TalkInvite = "11000000",
    TalkHangup = "12000000",
    OpenDoor = '01000000',
    CloseDoor = '06000000'
} 

export class HikvisionCameraAPI_KV6113_Destroyable extends EventEmitter implements Destroyable {

    constructor(public onDesctroy?: () => void) {
        super();
    }

    destroy(): void {

        if (this.onDesctroy)
            this.onDesctroy();
    }
}

export class HikvisionCameraAPI_KV6113 extends HikvisionCameraAPI {

    auth: AuthRequst;

    private eventServer?: Server;
    private eventServerLastSocket?: Socket;
    private eventBuffer: Buffer;
    private isIpv4: boolean;
    private eventServerUserName: String;
    private eventServerPassword: String;
    private listener: Destroyable;

    constructor(public ip: string, public port: string, username: string, password: string, public console: Console, public storage: Storage) {
        super(ip, port, username, password, console, storage);
        this.auth = new AuthRequst(username, password, console);
    }

    async request(urlOrOptions: string | HttpFetchOptions<Readable>, body?: AuthRequestBody) {

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

    async getDeviceInfo() {
        return getDeviceInfo({...this.credential}, this.endpoint);
    }

    async listenEvents() {
        // support multiple cameras listening to a single single stream 
        if (!this.listener) {

            await this.runHttpHostsListener();
            await this.installHttpHosts();

            this.listener = new HikvisionCameraAPI_KV6113_Destroyable( () => {
                this.listener = undefined;
            });
        }

        return this.listener;
    }

    async openDoor() {
        const data = '<RemoteControlDoor><cmd>alwaysOpen</cmd></RemoteControlDoor>';
        await this.request({
            url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/1`,
            method: 'PUT',
            responseType: 'readable',
        }, data);
    }

    async closeDoor() {
        const data = '<RemoteControlDoor><cmd>resume</cmd></RemoteControlDoor>';
        await this.request({
            url: `http://${this.endpoint}/ISAPI/AccessControl/RemoteControl/door/1`,
            method: 'PUT',
            responseType: 'readable',
        }, data);
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
            
            if (socket.remoteAddress != this.ip) {
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

        let host = "localhost";
        try {
            const typeCheck = this.isIpv4 ? isV4Format : isV6Format;
            for (const address of await sdk.endpointManager.getLocalAddresses()) {
                if (!isLoopback(address) && typeCheck(address)) {
                    host = address;
                    break;
                }
            }
        }
        catch (e) {
        }


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
                this.listener.emit ('close');
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

        for (const [name, event] of Object.entries(HikvisionCameraEvent_KV6113)) {
            if (marker == event) {
                this.listener.emit('event', event, cameraNumber, inactive);
                this.console.debug (`Camera event emited: "${name}"`);        
                return;
            }
        }

        this.console.info (`Unknown camera event: "${marker}"`);        
    }
}
