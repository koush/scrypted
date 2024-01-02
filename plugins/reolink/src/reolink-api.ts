import AxiosDigestAuth from "@koush/axios-digest-auth";
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

export class ReolinkCameraClient {
    digestAuth: AxiosDigestAuth;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console) {
        this.digestAuth = new AxiosDigestAuth({
            password,
            username,
        });
    }

    async reboot() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Reboot');
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.digestAuth.request({
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
        });
        return {
            value: response.data?.[0]?.value?.rspCode,
            data: response.data,
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
        return getMotionState(this.digestAuth, this.username, this.password, this.host, this.channelId);
    }

    async getAiState() {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetAiState');
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.digestAuth.request({
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
        });
        return {
            value: response.data?.[0]?.value as AIState,
            data: response.data,
        };
    }

    async jpegSnapshot() {
        const url = new URL(`http://${this.host}/cgi-bin/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Snap');
        params.set('channel', this.channelId.toString());
        params.set('rs', Date.now().toString());
        params.set('user', this.username);
        params.set('password', this.password);

        const response = await this.digestAuth.request({
            url: url.toString(),
            responseType: 'arraybuffer',
            httpsAgent: reolinkHttpsAgent,
            timeout: 60000,
        });

        return Buffer.from(response.data);
    }

    async getEncoderConfiguration(): Promise<Enc> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetEnc');
        // is channel used on this call?
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.digestAuth.request({
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
        });

        return response.data?.[0]?.value?.Enc;
    }

    async getDeviceInfo(): Promise<DevInfo> {
        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetDevInfo');
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.digestAuth.request({
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
        });

        return response.data?.[0]?.value?.DevInfo;
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

        if (!op)
            return;

        const url = new URL(`http://${this.host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'PtzCtrl');
        params.set('user', this.username);
        params.set('password', this.password);

        const c1 = this.digestAuth.request({
            method: 'POST',
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
            data: [
                {
                    cmd: "PtzCtrl",
                    param: {
                        channel: this.channelId,
                        op,
                        speed: 10,
                        timeout: 1,
                    }
                },
            ]
        });

        await sleep(500);

        const c2 = this.digestAuth.request({
            method: 'POST',
            url: url.toString(),
            httpsAgent: reolinkHttpsAgent,
            data: [
                {
                    cmd: "PtzCtrl",
                    param: {
                        channel: this.channelId,
                        op: "Stop"
                    }
                },
            ]
        });

        this.console.log(await c1);
        this.console.log(await c2);
    }
}
