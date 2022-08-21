import { Axios, Method } from "axios";
import { createHash, createHmac, randomBytes } from "crypto";
import { TuyaSupportedCountry } from "./tuya.utils";
import { DeviceFunction, TuyaDeviceStatus, RTSPToken, TuyaDeviceConfig, TuyaResponse } from "./tuya.const";


interface Session {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
    uid: string
}

export class TuyaCloud {

    // Tuya IoT Cloud API

    private readonly userId: string;
    private readonly clientId: string;
    private readonly secret: string;
    private readonly nonce: string;
    private readonly country: TuyaSupportedCountry;
    private session: Session | undefined;
    private client: Axios;

    private _cameras: TuyaDeviceConfig[] | null;

    constructor(
        userId: string,
        clientId: string,
        secret: string,
        country: TuyaSupportedCountry
    ) {
        this.userId = userId;
        this.clientId = clientId;
        this.secret = secret;
        this.nonce = randomBytes(16).toString('hex');
        this.country = country;
        this.client = new Axios({
            baseURL: country.endPoint,
            timeout: 5 * 1e3
        });
        this._cameras = null;
    }

    // Set Device Status

    public async updateDevice(
        device: TuyaDeviceConfig, 
        statuses: TuyaDeviceStatus[]
    ): Promise<boolean> {
        if (!device) {
            return false;
        }

        const result = await this.post<boolean>(
            `/v1.0/devices/${device.id}/commands`, 
            {
                commands: statuses
            }
        );

        return result.success && result.result;
    }

    // Get Devices

    public async fetchDevices(): Promise<boolean> {
        let response = await this.get<TuyaDeviceConfig[]>(`/v1.0/users/${this.userId}/devices`);

        if (!response.success) {
            return false;
        }

        let devicesState = response.result;

        for (const state of devicesState) {
            let response = await this.get<DeviceFunction[]>(`/v1.0/devices/${state.id}/functions`);
            if (!response.success) {
                continue;
            }

            state.functions = response.result;
        }

        this._cameras = devicesState.filter(element => element.category === 'sp');
        return true;
    }

    public get cameras(): TuyaDeviceConfig[] | null {
        return this._cameras;
    }

    // Camera Functions

    public async getRTSPS(camera: TuyaDeviceConfig): Promise<RTSPToken | undefined> {
        interface RTSPResponse {
            url: string
        }

        const response = await this.post<RTSPResponse>(
            `/v1.0/devices/${camera.id}/stream/actions/allocate`,
            { type: 'rtsp' }
        );

        if (response.success) {
            return {
                url: response.result.url,
                expires: new Date(response.t + 30 * 1000)   // This will expire in 30 seconds.
            };
        } else {
            return undefined;
        }
    }

    // User Requests

    async getUser(): Promise<TuyaResponse<undefined>> {
        return this.get<undefined>(`/v1.0/users/${this.userId}/infos`);
    }

    // Tuya IoT Cloud Requests API

    async get<T>(
        path: string,
        query: { [k: string]: any } = {},
    ): Promise<TuyaResponse<T>> {
        return this.request<T>('GET', path, query);
    }

    async post<T>(
        path: string,
        body: { [k: string]: any } = {}
    ): Promise<TuyaResponse<T>> {
        return this.request<T>('POST', path, {}, body);
    }

    private async request<T = any>(
        method: Method,
        path: string,
        query: { [k: string]: any } = {},
        body: { [k: string]: any } = {}
    ): Promise<TuyaResponse<T>> {
        await this.refreshAccessTokenIfNeeded();

        const timestamp = Date.now().toString();
        const headers = { client_id: this.clientId };

        const stringToSign = this.getStringToSign(method, path, query, headers, body);
        const hmac = createHmac('sha256', this.secret);
        const sign = hmac.update(this.clientId + this.session.accessToken + timestamp + this.nonce + stringToSign).digest('hex').toUpperCase();

        let requestHeaders = {
            'client_id': this.clientId,
            'sign': sign,
            'sign_method': 'HMAC-SHA256',
            't': timestamp,
            'access_token': this.session.accessToken,
            'Signature-Headers': Object.keys(headers).join(':'),
            'nonce': this.nonce
        };

        return this.client.request<TuyaResponse<T>>({
            method,
            url: path,
            data: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
            params: query,
            headers: requestHeaders,
            responseType: 'json',
            transformResponse: (data) => JSON.parse(data)
        })
            .then(value => { return value.data });
    }

    private getStringToSign(
        method: Method,
        path: string,
        query: { [k: string]: any } = {},
        headers: { [k: string]: string } = {},
        body: { [k: string]: any } = {}
    ): string {
        const isQueryEmpty = Object.keys(query).length == 0;
        const isHeaderEmpty = Object.keys(headers).length == 0;
        const isBodyEmpty = Object.keys(body).length == 0;
        const httpMethod = method.toUpperCase();
        const url = path + (isQueryEmpty ? '' : '?' + Object.keys(query).map(key => { return `${key}=${query[key]}` }).join('&'));
        const sha256 = createHash('sha256');
        const contentHashed = sha256.update(isBodyEmpty ? '' : JSON.stringify(body)).digest('hex');
        const headersParsed = Object.keys(headers).map(key => { return `${key}:${headers[key]}` }).join('\n')
        const signStr = [httpMethod, contentHashed, (isHeaderEmpty ? '' : headersParsed + '\n'), url].join('\n');
        return signStr
    }

    private async refreshAccessTokenIfNeeded() {
        if (this.session && this.session.tokenExpiresAt.getTime() > Date.now()) {
            return;
        }

        let url: string

        if (!this.session) {
            url = '/v1.0/token?grant_type=1'
        } else {
            url = `/v1.0/token/${this.session.refreshToken}`
        }

        const timestamp = new Date().getTime().toString();
        const stringToSign = this.getStringToSign('GET', url);
        const hmac = createHmac('sha256', this.secret);
        const signString = hmac.update(this.clientId + timestamp + stringToSign).digest('hex').toUpperCase();

        const headers = {
            t: timestamp,
            sign_method: 'HMAC-SHA256',
            client_id: this.clientId,
            sign: signString,
        };

        let { data } = await this.client.get(url,
            { headers }
        );

        let objData = JSON.parse(data);

        const newExpiration = new Date(Date.now() + objData.result.expire_time * 1000);

        this.session = {
            accessToken: objData.result.access_token,
            refreshToken: objData.result.refresh_token,
            tokenExpiresAt: newExpiration,
            uid: objData.result.uid
        };
    }
}