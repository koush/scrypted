import axios from 'axios';
import AxiosDigestAuth from "@koush/axios-digest-auth/dist";
import https from 'https';

export class ReolinkCameraClient {
    digestAuth: AxiosDigestAuth;
    axios = axios.create({
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        })
    });

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console) {
        this.digestAuth = new AxiosDigestAuth({
            axios: this.axios,
            password,
            username,
        });
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
        const url = new URL(`http://${this.host}/cgi-bin/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'GetMdState');
        params.set('channel', this.channelId.toString());
        params.set('user', this.username);
        params.set('password', this.password);
        const response = await this.digestAuth.request({
            url: url.toString(),
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
            responseType: 'arraybuffer'
        });

        return Buffer.from(response.data);
    }
}
