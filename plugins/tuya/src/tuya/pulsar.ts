// From Tuya Pulsar (Node.js)
// https://developer.tuya.com/en/docs/iot/Pulsar-SDK-get-message-nodejs?id=Kawfmtxp8yscg

import Event from 'events';
import WebSocket from 'ws';
import { MD5, AES, enc, mode, pad } from 'crypto-js';

export interface TuyaPulsarMessage {
    payload: {
        data: {
            devId: string;
            productKey: string;
            bizCode?: string;
            bizData?: any;
            status?: StatusItem[]                    
        }
        protocol: number;
        pv: string;
        sign: string;
        t: number;
    }
    messageId: string;
    properties: any;
    publishTime: string;
    redeliveryCount: number;
    key: string;
}

interface StatusItem {
    code: string;
    value: any;
    t: number;
    // "data point": string
}

interface IConfig {
    accessId: string;
    accessKey: string;
    url: string;

    timeout?: number;
    maxRetryTimes?: number;
    retryTimeout?: number;
}

export class TuyaPulsar {
    static data = 'TUTA_DATA';
    static error = 'TUYA_ERROR';
    static open = 'TUYA_OPEN';
    static close = 'TUYA_CLOSE';
    static reconnect = 'TUYA_RECONNECT';
    static ping = 'TUYA_PING';
    static pong = 'TUYA_PONG';
    static maxRetries = 'TUYA_MAXRETRIES';

    private config: IConfig;
    private server?: WebSocket;
    private timer: any;
    private retryTimes: number;
    private event: Event;

    constructor(config: IConfig) {
        this.config = Object.assign(
            {
                ackTimeoutMillis: 3000,
                subscriptionType: 'Failover',
                retryTimeout: 1000,
                maxRetryTimes: 10,
                timeout: 30000,
                logger: console.log,
            },
            config
        );
        this.event = new Event();
        this.retryTimes = 0;
    }

    public start() {
        this.server = this._connect();
    }

    public stop() {
        this.server?.terminate();
    }

    public open(cb: (ws: WebSocket) => void) {
        this.event.on(TuyaPulsar.open, cb);
    }

    public message(cb: (ws: WebSocket, message: any) => void) {
        this.event.on(TuyaPulsar.data, cb);
    }

    public ping(cb: (ws: WebSocket) => void) {
        this.event.on(TuyaPulsar.ping, cb);
    }

    public pong(cb: (ws: WebSocket) => void) {
        this.event.on(TuyaPulsar.pong, cb);
    }

    public reconnect(cb: (ws: WebSocket) => void) {
        this.event.on(TuyaPulsar.reconnect, cb);
    }

    public ackMessage(messageId: string) {
        this.server && this.server.send(JSON.stringify({ messageId }));
    }

    public error(cb: (ws: WebSocket, error: any) => void) {
        this.event.on(TuyaPulsar.error, cb);
    }

    public close(cb: (ws: WebSocket) => void) {
        this.event.on(TuyaPulsar.close, cb);
    }

    public maxRetries(cb: () => void) {
        this.event.on(TuyaPulsar.maxRetries, cb);
    }

    private _reconnect() {
        if (this.config.maxRetryTimes && this.retryTimes < this.config.maxRetryTimes) {
            const timer = setTimeout(() => {
                clearTimeout(timer);
                this.retryTimes++;
                this._connect(false);
            }, this.config.retryTimeout);
        } else {
            this.clearKeepAlive();
            this.event.emit(TuyaPulsar.maxRetries);
        }
    }

    private _connect(isInit = true) {
        const { accessId, accessKey, url } = this.config;
        const topicUrl = getTopicUrl(
            url,
            accessId,
            'event',
            `?${buildQuery({ subscriptionType: 'Failover', ackTimeoutMillis: 30000 })}`,
        );
        const password = buildPassword(accessId, accessKey);
        this.server = new WebSocket(topicUrl, {
            rejectUnauthorized: false,
            headers: { username: accessId, password },
        });
        this.subOpen(this.server, isInit);
        this.subMessage(this.server);
        this.subPing(this.server);
        this.subPong(this.server);
        this.subError(this.server);
        this.subClose(this.server);
        return this.server;
    }

    private subOpen(server: WebSocket, isInit = true) {
        server.on('open', () => {
            if (server.readyState === server.OPEN) {
                this.retryTimes = 0;
            }
            this.keepAlive(server);
            this.event.emit(
                isInit ? TuyaPulsar.open : TuyaPulsar.reconnect,
                this.server,
            );
        });
    }

    private subPing(server: WebSocket) {
        server.on('ping', () => {
            this.event.emit(TuyaPulsar.ping, this.server);
            this.keepAlive(server);
            server.pong(this.config.accessId);
        });
    }

    private subPong(server: WebSocket) {
        server.on('pong', () => {
            this.keepAlive(server);
            this.event.emit(TuyaPulsar.pong, this.server);
        });
    }

    private subMessage(server: WebSocket) {
        server.on('message', (data: any) => {
            try {
                this.keepAlive(server);
                const obj = this.handleMessage(data);
                this.event.emit(TuyaPulsar.data, this.server, obj);
            } catch (e) {
                this.event.emit(TuyaPulsar.error, e);
            }
        });
    }

    private subClose(server: WebSocket) {
        server.on('close', (...data) => {
            this._reconnect();
            this.clearKeepAlive();
            this.event.emit(TuyaPulsar.close, ...data);
        });
    }

    private subError(server: WebSocket) {
        server.on('error', (e) => {
            this.event.emit(TuyaPulsar.error, this.server, e);
        });
    }

    private clearKeepAlive() {
        clearTimeout(this.timer);
    }

    private keepAlive(server: WebSocket) {
        this.clearKeepAlive();
        this.timer = setTimeout(() => {
            server.ping(this.config.accessId);
        }, this.config.timeout);
    }

    private handleMessage(data: string): TuyaPulsarMessage {
        const { payload, ...others } = JSON.parse(data);
        const pStr = Buffer.from(payload, 'base64').toString('utf-8');
        const pJson = JSON.parse(pStr);
        pJson.data = decrypt(pJson.data, this.config.accessKey);
        return { payload: pJson, ...others };
    }
}

function getTopicUrl(websocketUrl: string, accessId: string, env: string, query: string) {
    return `${websocketUrl}ws/v2/consumer/persistent/${accessId}/out/${env}/${accessId}-sub${query}`;
}

function buildQuery(query: { [key: string]: number | string }) {
    return Object.keys(query)
        .map((key) => `${key}=${encodeURIComponent(query[key])}`)
        .join('&');
}

function buildPassword(accessId: string, accessKey: string) {
    const key = MD5(accessKey).toString();
    return MD5(`${accessId}${key}`).toString().substr(8, 16);
}

function decrypt(data: string, accessKey: string): TuyaPulsarMessage | undefined {
    try {
        const realKey = enc.Utf8.parse(accessKey.substring(8, 24));
        const json = AES.decrypt(data, realKey, {
            mode: mode.ECB,
            padding: pad.Pkcs7,
        });
        const dataStr = enc.Utf8.stringify(json).toString();
        return JSON.parse(dataStr);
    } catch (e) {
        return undefined;
    }
}

function encrypt(data: any, accessKey: string) {
    try {
        const realKey = enc.Utf8.parse(accessKey.substring(8, 24));
        const realData = JSON.stringify(data);
        const retData = AES.encrypt(realData, realKey, {
            mode: mode.ECB,
            padding: pad.Pkcs7,
        }).toString();
        return retData;
    } catch (e) {
        return '';
    }
}

