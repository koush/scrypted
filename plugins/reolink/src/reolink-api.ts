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

export interface PurpleOsdChannel {
    enable: number;
    name: string;
    pos: string;
}

export interface PurpleOsdTime {
    enable: number;
    pos: string;
}
export interface InitialOsd {
    bgcolor: number;
    channel: number;
    osdChannel: PurpleOsdChannel;
    osdTime: PurpleOsdTime;
    watermark: number;
}

export interface Initial {
    Osd: InitialOsd;
}

export interface Osd {
    cmd: string;
    code: number;
    initial: Initial;
    range: Range;
    value: Initial;
}


export interface AIDetectionState {
    alarm_state: number;
    support: number;
}

type AiKey = 'dog_cat' | 'face' | 'other' | 'package' | 'people';

export type AIState = Partial<Record<AiKey, AIDetectionState>> & {
    channel: number;
};

export type SirenResponse = {
    rspCode: number;
}

export interface PtzPreset {
    id: number;
    name: string;
}

export class ReolinkCameraClient {
    credential: AuthFetchCredentialState;
    parameters: Record<string, string>;
    tokenLease: number;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console, public readonly forceToken?: boolean) {
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

    private createReadable = (data: any) => {
        const pt = new PassThrough();
        pt.write(Buffer.from(JSON.stringify(data)));
        pt.end();
        return pt;
    }

    async login() {
        if (this.tokenLease > Date.now()) {
            return;
        }

        this.console.log(`token expired at ${this.tokenLease}, renewing...`);

        const { parameters, leaseTimeSeconds } = await getLoginParameters(this.host, this.username, this.password, this.forceToken);
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

    async getOsd(): Promise<Osd> {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "GetOsd",
                action: 1,
                param: { channel: this.channelId }
            },
        ];

        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
            method: 'POST',
        }, this.createReadable(body));

        const error = response.body?.find(elem => elem.error)?.error;
        if (error) {
            this.console.error('error during call to getOsd', error);
        }

        return response.body?.[0] as Osd;
    }

    async setOsd(osd: Osd) {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "SetOsd",
                param: {
                    Osd: {
                        channel: this.channelId,
                        osdChannel: osd.value.Osd.osdChannel,
                        osdTime: osd.value.Osd.osdTime,
                    }
                }
            }
        ];

        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
            method: 'POST',
        }, this.createReadable(body));

        const error = response.body?.find(elem => elem.error)?.error;
        if (error) {
            this.console.error('error during call to getOsd', error);
        }
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
        let response = await this.requestWithLogin({
            url,
            responseType: 'json',
        });
        let error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getAbility GET, Trying with POST', error);

            url.search = '';

            const body = [
                {
                    cmd: "GetAbility",
                    action: 0,
                    param: { User: { userName: this.username } }
                }
            ];

            response = await this.requestWithLogin({
                url,
                responseType: 'json',
                method: 'POST',
            }, this.createReadable(body));

            error = response.body?.[0]?.error;
            if (error) {
                this.console.error('error during call to getAbility GET, Trying with POST', error);
                throw new Error('error during call to getAbility');
            }
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

        const deviceInfo: DevInfo = await response.body?.[0]?.value?.DevInfo;

        // Will need to check if it's valid for NVR and NVR_WIFI
        if (!['HOMEHUB', 'NVR', 'NVR_WIFI'].includes(deviceInfo.exactType)) {
            return deviceInfo;
        }

        // If the device is listed as homehub, fetch the channel specific information
        url.search = '';
        const body = [
            { cmd: "GetChnTypeInfo", action: 0, param: { channel: this.channelId } },
            { cmd: "GetChannelstatus", action: 0, param: {} },
        ]

        const additionalInfoResponse = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json'
        }, this.createReadable(body));

        const chnTypeInfo = additionalInfoResponse?.body?.find(elem => elem.cmd === 'GetChnTypeInfo');
        const chnStatus = additionalInfoResponse?.body?.find(elem => elem.cmd === 'GetChannelstatus');

        if (chnTypeInfo?.value) {
            deviceInfo.firmVer = chnTypeInfo.value.firmVer;
            deviceInfo.model = chnTypeInfo.value.typeInfo;
            deviceInfo.pakSuffix = chnTypeInfo.value.pakSuffix;
        }

        if (chnStatus?.value) {
            const specificChannelStatus = chnStatus.value?.status?.find(elem => elem.channel === this.channelId);

            if (specificChannelStatus) {
                deviceInfo.name = specificChannelStatus.name;
            }
        }


        return deviceInfo;
    }

    async getPtzPresets(): Promise<PtzPreset[]> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetPtzPreset');
        const body = [
            {
                cmd: "GetPtzPreset",
                action: 1,
                param: {
                    channel: this.channelId
                }
            }
        ];
        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
            method: 'POST'
        }, this.createReadable(body));
        return response.body?.[0]?.value?.PtzPreset?.filter(preset => preset.enable === 1);
    }

    private async ptzOp(op: string, speed: number, id?: number) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'PtzCtrl');

        const c1 = this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'text',
        }, this.createReadable([
            {
                cmd: "PtzCtrl",
                param: {
                    channel: this.channelId,
                    op,
                    speed,
                    timeout: 1,
                    id
                }
            },
        ]));

        await sleep(500);

        const c2 = this.requestWithLogin({
            url,
            method: 'POST',
        }, this.createReadable([
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

    private async presetOp(speed: number, id: number) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'PtzCtrl');

        const c1 = this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'text',
        }, this.createReadable([
            {
                cmd: "PtzCtrl",
                param: {
                    channel: this.channelId,
                    op: 'ToPos',
                    speed,
                    id
                }
            },
        ]));
    }

    async ptz(command: PanTiltZoomCommand) {
        // reolink doesnt accept signed values to ptz
        // in favor of explicit direction.
        // so we need to convert the signed values to abs explicit direction.
        if (command.preset && !Number.isNaN(Number(command.preset))) {
            await this.presetOp(1, Number(command.preset));
            return;
        }

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
            await this.ptzOp(op, Math.ceil(Math.abs(command?.pan || command?.tilt || 1) * 10));
        }

        op = undefined;
        if (command.zoom < 0)
            op = 'ZoomDec';
        else if (command.zoom > 0)
            op = 'ZoomInc';

        if (op) {
            await this.ptzOp(op, Math.ceil(Math.abs(command?.zoom || 1) * 10));
        }
    }

    async getSiren() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [{
            cmd: 'GetAudioAlarmV20',
            action: 0,
            param: { channel: this.channelId }
        }];

        const response = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json',
        }, this.createReadable(body));

        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getSiren', JSON.stringify(body), error);
        }

        return {
            enabled: response.body?.[0]?.value?.Audio?.enable === 1
        };
    }

    async setSiren(on: boolean, duration?: number) {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'AudioAlarmPlay');

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
        }, this.createReadable([
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

    async getWhiteLedState() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [{
            cmd: 'GetWhiteLed',
            action: 0,
            param: { channel: this.channelId }
        }];

        const response = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json',
        }, this.createReadable(body));

        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getWhiteLedState', JSON.stringify(body), error);
        }

        return {
            enabled: response.body?.[0]?.value?.WhiteLed?.state === 1
        };
    }

    async setWhiteLedState(on?: boolean, brightness?: number) {
        const url = new URL(`http://${this.host}/api.cgi`);

        const settings: any = { channel: this.channelId };

        if (on !== undefined) {
            settings.state = on ? 1 : 0;
        }

        if (brightness !== undefined) {
            settings.bright = brightness;
        }

        const body = [{
            cmd: 'SetWhiteLed',
            param: { WhiteLed: settings }
        }];

        const response = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json',
        }, this.createReadable(body));

        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to setWhiteLedState', JSON.stringify(body), error);
        }
    }

    async getBatteryInfo() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "GetBatteryInfo",
                action: 0,
                param: { channel: this.channelId }
            },
            {
                cmd: "GetChannelstatus",
            }
        ];

        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
            method: 'POST',
        }, this.createReadable(body));

        const error = response.body?.find(elem => elem.error)?.error;
        if (error) {
            this.console.error('error during call to getBatteryInfo', error);
        }

        const batteryInfoEntry = response.body.find(entry => entry.cmd === 'GetBatteryInfo')?.value?.Battery;
        const channelStatusEntry = response.body.find(entry => entry.cmd === 'GetChannelstatus')?.value?.status
            ?.find(chStatus => chStatus.channel === this.channelId)

        return {
            batteryPercent: batteryInfoEntry?.batteryPercent,
            sleeping: channelStatusEntry?.sleep === 1,
        }
    }

    async getEvents() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "GetEvents",
                action: 0,
                param: { channel: this.channelId }
            },
        ];

        const response = await this.requestWithLogin({
            url,
            responseType: 'json',
            method: 'POST',
        }, this.createReadable(body));

        const error = response.body?.find(elem => elem.error)?.error;
        if (error) {
            this.console.error('error during call to getEvents', error);
        }

        return {
            value: (response.body?.[0]?.value?.ai || response.body?.value?.ai) as AIState,
            data: response.body,
        };
    }

    async getPirState() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [{
            cmd: 'GetPirInfo',
            action: 0,
            param: { channel: this.channelId }
        }];

        const response = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json',
        }, this.createReadable(body));

        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to getPirState', JSON.stringify(body), error);
        }

        return {
            enabled: response.body?.[0]?.value?.pirInfo?.enable === 1,
            state: response.body?.[0]?.value?.pirInfo
        };
    }

    async setPirState(on: boolean) {
        const url = new URL(`http://${this.host}/api.cgi`);

        const currentPir = await this.getPirState();
        const newState = on ? 1 : 0;

        if (!currentPir || currentPir.state?.enable === newState) {
            return;
        }

        const pirInfo = {
            ...currentPir,
            channel: this.channelId,
            enable: newState
        }

        const body = [{
            cmd: 'SetPirInfo',
            action: 0,
            param: { pirInfo }
        }];

        const response = await this.requestWithLogin({
            url,
            method: 'POST',
            responseType: 'json',
        }, this.createReadable(body));

        const error = response.body?.[0]?.error;
        if (error) {
            this.console.error('error during call to setPirState', JSON.stringify(body), error);
        }
    }
}
