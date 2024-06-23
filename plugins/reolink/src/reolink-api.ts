import { AuthFetchCredentialState, AuthFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { EventEmitter } from 'events';
import https, { RequestOptions } from 'https';
import { PassThrough, Readable } from 'stream';
import { HttpFetchOptions, HttpFetchResponseType } from '../../../server/src/fetch/http-fetch';

import { getMotionState, reolinkHttpsAgent } from './probe';
import { PanTiltZoomCommand } from "@scrypted/sdk";
import { sleep } from "@scrypted/common/src/sleep";

export interface Enc {
    audio: number;
    channel: number;
    mainStream: Stream;
    subStream: Stream;
}

export interface Stream {
    bitRate: number;
    frameRate: number;
    gop: number;
    height: number;
    profile: string;
    size: string;
    vType: string;
    width: number;
}

export interface DevInfo {
    B485: number;
    IOInputNum: number;
    IOOutputNum: number;
    audioNum: number;
    buildDay: string;
    cfgVer: string;
    channelNum: number;
    detail: string;
    diskNum: number;
    exactType: string;
    firmVer: string;
    frameworkVer: number;
    hardVer: string;
    model: string;
    name: string;
    pakSuffix: string;
    serial: string;
    type: string;
    wifi: number;
}

export interface AIDetectionState {
    alarm_state: number;
    support: number;
}

export type AIState = {
    [key: string]: AIDetectionState;
} & {
    channel: number;
};

export type SirenResponse = {
    rspCode: number;
}

export class ReolinkCameraClient {
    credential: AuthFetchCredentialState;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console) {
        this.credential = {
            username,
            password,
        };
    }

    async request(urlOrOptions: string | URL | HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions : {
                url: urlOrOptions,
            },
            rejectUnauthorized: false,
            credential: this.credential,
            body,
        });
        return response;
    }

    async reboot() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Reboot');
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.request({
            url: url.toString(),
            responseType: 'json',
        });
        return {
            value: response.body?.[0]?.value?.rspCode,
            data: response.body,
        };
    }

    // [
    //     {
    //        "cmd" : "GetMdState",
    //        "code" : 0,
    //        "value" : {
    //           "state" : 0
    //        }
    //     }
    //  ]
    async getMotionState() {
        return getMotionState(this.credential, this.username, this.password, this.host, this.channelId);
    }

    async getAiState() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetAiState');
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.request({
            url,
            responseType: 'json',
        });
        return {
            value: (response.body?.[0]?.value || response.body?.value) as AIState,
            data: response.body,
        };
    }

    async getAbility() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetAbility');
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.request({
            url,
            responseType: 'json',
        });
        return {
            value: response.body?.[0]?.value || response.body?.value,
            data: response.body,
        };
    }

    async jpegSnapshot(timeout = 10000) {
        const url = new URL(`http://${this.host}/cgi-bin/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Snap');
        params.set('channel', this.channelId.toString());
        params.set('rs', Date.now().toString());
        params.set('user', this.username);
        params.set('password', this.password);

        const response = await this.request({
            url,
            timeout,
        });

        return response.body;
    }

    async getEncoderConfiguration(): Promise<Enc> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetEnc');
        // is channel used on this call?
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.request({
            url,
            responseType: 'json',
        });

        return response.body?.[0]?.value?.Enc;
    }

    async getDeviceInfo(): Promise<DevInfo> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetDevInfo');
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.request({
            url,
            responseType: 'json',
        });

        return response.body?.[0]?.value?.DevInfo;
    }

    async ptzOp(op: string) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'PtzCtrl');
        params.set('user', this.username);
        params.set('password', this.password);

        const createReadable = (data: any) => {
            const pt = new PassThrough();
            pt.write(Buffer.from(JSON.stringify(data)));
            pt.end();
            return pt;
        }

        const c1 = this.request({
            url,
            method: 'POST',
            responseType: 'text',
        }, createReadable([
            {
                cmd: "PtzCtrl",
                param: {
                    channel: this.channelId,
                    op,
                    speed: 10,
                    timeout: 1,
                }
            },
        ]));

        await sleep(500);

        const c2 = this.request({
            url,
            method: 'POST',
        }, createReadable([
            {
                cmd: "PtzCtrl",
                param: {
                    channel: this.channelId,
                    op: "Stop"
                }
            },
        ]));

        this.console.log(await c1);
        this.console.log(await c2);
    }

    async ptz(command: PanTiltZoomCommand) {
        let op = '';
        if (command.pan < 0)
            op += 'Left';
        else if (command.pan > 0)
            op += 'Right'
        if (command.tilt < 0)
            op += 'Down';
        else if (command.tilt > 0)
            op += 'Up';

        if (op) {
            await this.ptzOp(op);
        }

        if (command.zoom < 0)
            op = 'ZoomDec';
        else if (command.zoom > 0)
            op = 'ZoomInc';

        if (op) {
            await this.ptzOp(op);
        }
    }

    async setSiren(on: boolean, duration?: number) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'AudioAlarmPlay');
        params.set('user', this.username);
        params.set('password', this.password);
        const createReadable = (data: any) => {
            const pt = new PassThrough();
            pt.write(Buffer.from(JSON.stringify(data)));
            pt.end();
            return pt;
        }

        let alarmMode;
        if (duration) {
            alarmMode = {
                alarm_mode: 'times',
                times: duration
            };
        }
        else {
            alarmMode = {
                alarm_mode: 'manul',
                manual_switch: on? 1 : 0
            };
        }

        const response = await this.request({
            url,
            method: 'POST',
            responseType: 'json',
        }, createReadable([
            {
                cmd: "AudioAlarmPlay",
                action: 0,
                param: {
                    channel: this.channelId,
                    ...alarmMode
                }
            },
        ]));
        return {
            value: (response.body?.[0]?.value || response.body?.value) as SirenResponse,
            data: response.body,
        };
    }
}
