import AxiosDigestAuth from "@koush/axios-digest-auth";
import { getMotionState, reolinkHttpsAgent } from './probe';

export interface Enc {
    audio:      number;
    channel:    number;
    mainStream: Stream;
    subStream:  Stream;
}

export interface Stream {
    bitRate:   number;
    frameRate: number;
    gop:       number;
    height:    number;
    profile:   string;
    size:      string;
    vType:     string;
    width:     number;
}

export interface DevInfo {
    B485:         number;
    IOInputNum:   number;
    IOOutputNum:  number;
    audioNum:     number;
    buildDay:     string;
    cfgVer:       string;
    channelNum:   number;
    detail:       string;
    diskNum:      number;
    exactType:    string;
    firmVer:      string;
    frameworkVer: number;
    hardVer:      string;
    model:        string;
    name:         string;
    pakSuffix:    string;
    serial:       string;
    type:         string;
    wifi:         number;
}

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
            value: !!response.data?.[0]?.value?.state,
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
}
