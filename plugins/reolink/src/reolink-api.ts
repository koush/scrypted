import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { PassThrough, Readable } from 'stream';
import { HttpFetchOptions } from '../../../server/src/fetch/http-fetch';

import { sleep } from "@scrypted/common/src/sleep";
import { PanTiltZoomCommand } from "@scrypted/sdk";
import { DevInfo, getLoginParameters } from './probe';

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
    parameters: Record<string, string>;
    tokenLease: number;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console) {
        this.credential = {
            username,
            password,
        };
    }

    private async request(options: HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...options,
            rejectUnauthorized: false,
            credential: this.credential,
            body,
        });
        return response;
    }

    async login() {
        if (this.tokenLease > Date.now()) {
            return;
        }

        this.console.log(`token expired at ${this.tokenLease}, renewing...`);

        const { parameters, leaseTimeSeconds } = await getLoginParameters(this.host, this.username, this.password);
        this.parameters = parameters
        this.tokenLease = Date.now() + 1000 * leaseTimeSeconds;
    }

    async requestWithLogin(options: HttpFetchOptions<Readable>, body?: Readable) {
        await this.login();
        const url = options.url as URL;
        const params = url.searchParams;
        for (const [k, v] of Object.entries(this.parameters)) {
            params.set(k, v);
        }
        return this.request(options, body);
    }

    async reboot() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Reboot');
        const response = await this.requestWithLogin({
            url,
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
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetMdState');
        params.set('channel', this.channelId.toString());
        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
        });
        return {
            value: !!response.body?.[0]?.value?.state,
            data: response.body,
        };
    }

    async getAiState() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetAiState');
        params.set('channel', this.channelId.toString());
        const response = await this.requestWithLogin({
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
        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
        });
        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getAbility', error);
            throw new Error('error during call to getAbility');
        }
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

        const response = await this.requestWithLogin({
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
        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
        });

        return response.body?.[0]?.value?.Enc;
    }

    async getDeviceInfo(): Promise<DevInfo> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetDevInfo');
        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
        });
        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getDeviceInfo', error);
            throw new Error('error during call to getDeviceInfo');
        }
        return response.body?.[0]?.value?.DevInfo;
    }

    private async ptzOp(op: string) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'PtzCtrl');

        const createReadable = (data: any) => {
            const pt = new PassThrough();
            pt.write(Buffer.from(JSON.stringify(data)));
            pt.end();
            return pt;
        }

        const c1 = this.requestWithLogin({
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

        const c2 = this.requestWithLogin({
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
                manual_switch: on ? 1 : 0
            };
        }

        const response = await this.requestWithLogin({
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
