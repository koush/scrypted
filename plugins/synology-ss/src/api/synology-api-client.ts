import axios, { AxiosInstance } from 'axios';
import https from 'https';

const errorCodeDescriptions = {
    '100': 'Unknown error',
    '101': 'Invalid parameters',
    '102': 'API does not exist',
    '103': 'Method does not exist',
    '104': 'This API version is not supported',
    '105': 'Insufficient user privilege',
    '106': 'Connection time out',
    '107': 'Multiple login detected'
}


const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export class SynologyApiClient {
    private apiInfo: Promise<Record<string, SynologyApiInfo>>;
    private readonly client: AxiosInstance;

    public readonly url: string;

    constructor(url: string) {
        this.url = url;
        this.client = axios.create({
            baseURL: `${url}/webapi/`,
            timeout: 10000,
            httpsAgent,
        });

        // Fetch info about API method paths and versions in the background
        this.apiInfo = this.queryApiInfo();
    }

    public async getCameraLiveViewPath(cameraIds: string[]): Promise<SynologyCameraLiveViewPath[]> {
        const params = {
            api: 'SYNO.SurveillanceStation.Camera',
            version: 9,
            method: 'GetLiveViewPath',
            idList: cameraIds.join(',')
        };

        const errorCodeDescs = {
            '400': 'Execution failed',
            // Usually when 401 happens, there's a "Fail to get local host Ip str!" error in surveillance.log.
            // One instance it was due to an old network bridge configured in Docker that had to be removed.
            '401': 'Parameter invalid (possibly due to misconfigured Synology network interface -- run ifconfig on your server)',
            '402': 'Camera disabled'
        };

        return await this.sendRequest<SynologyCameraLiveViewPath[]>(params, null, false, errorCodeDescs);
    }

    public async getCameraSnapshot(cameraId: number | string) {
        const params = {
            api: 'SYNO.SurveillanceStation.Camera',
            version: 9,
            method: 'GetSnapshot',
            id: cameraId
        };

        const response = await this.client.get<ArrayBuffer>(await this.getApiPath(params.api), { params, responseType: 'arraybuffer' });

        return response.data;
    }

    public async listCameras(): Promise<SynologyCamera[]> {
        const params = {
            api: 'SYNO.SurveillanceStation.Camera',
            version: 9,
            method: 'List',
            privCamType: 1,
            streamInfo: true,
            basic: true
        };

        const response = await this.sendRequest<SynologyApiListCamerasResponse>(params);

        return response.cameras;
    }

    public async getCameraInfo(cameraId: number | string): Promise<SynologyCameraInfo> {
        const params = {
            api: 'SYNO.SurveillanceStation.Camera',
            version: 8,
            method: 'GetInfo',
            privCamType: 1,
            streamInfo: true,
            cameraIds: cameraId
        };

        const response = await this.sendRequest<SynologyCameraInfoResponse>(params);

        return response.cameras[0];
    }

    public async login(account: string, password: string, otpCode?: number, enableDeviceToken: boolean = false, deviceName?: string,
        deviceId?: string): Promise<string | undefined> {
        const params = {
            api: 'SYNO.API.Auth',
            version: 6,
            method: 'login',
            session: 'SurveillanceStation',
            account: account,
            passwd: password
        };

        if (otpCode) {
            params['otp_code'] = otpCode;
        }

        if (enableDeviceToken) {
            params['enable_device_token'] = enableDeviceToken ? 'yes' : 'no';
        }

        if (deviceName) {
            params['device_name'] = deviceName;
        }

        if (deviceId) {
            params['device_id'] = deviceId;
        }

        const errorCodeDescs = {
            '400': 'Invalid password',
            '401': 'Guest or disabled account',
            '402': 'Permission denied',
            '403': 'One time password not specified',
            '404': 'One time password authenticate failed',
            '405': 'App portal incorrect',
            '406': 'OTP code enforced',
            '407': 'Max Tries (if auto blocking is set to true)',
            '408': 'Password Expired Can not Change',
            '409': 'Password Expired',
            '410': 'Password must change (when first time use or after reset password by admin)',
            '411': 'Account Locked (when account max try exceed)'
        };

        const response = await this.sendRequest<SynologyApiAuthResponse>(params, null, true, errorCodeDescs);

        return response.did;
    }

    private async queryApiInfo(): Promise<Record<string, SynologyApiInfo>> {
        const params = {
            api: 'SYNO.API.Info',
            version: 1,
            method: 'Query',
            query: 'SYNO.API.Auth,SYNO.SurveillanceStation.'
        };

        return await this.sendRequest<Record<string, SynologyApiInfo>>(params, 'query.cgi');
    }

    private async getApiPath(api: string): Promise<string> {
        return (await this.apiInfo)[api].path;
    }

    private async sendRequest<T>(params: SynologyApiRequestParams, url?: string, storeCookies: boolean = false,
        extraErrorCodes?: Record<string, string>): Promise<T> {
        const response = await this.client.get<SynologyApiResponse<T>>(url ?? await this.getApiPath(params.api), { params });

        if (!response.data?.success) {
            const errorCode = response.data?.error?.code;
            if (errorCode) {
                const errorCodeLookup = { ...errorCodeDescriptions, ...extraErrorCodes }
                throw new SynologyApiError(`${errorCodeLookup[errorCode]} (error code ${errorCode})`, errorCode)
            } else {
                throw new SynologyApiError(`Synology API call failed with status code ${response.status}`);
            }
        }

        if (storeCookies) {
            this.client.defaults.headers.common['Cookie'] = response.headers["set-cookie"].join('; ');
        }

        return response.data.data;
    }
}

export interface SynologyApiInfo {
    path: string;
    minVersion: number;
    maxVersion: number;
}

export class SynologyApiError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
        super(message);
        
        this.name = 'SynologyApiError';
        this.code = code;
    }
}

export interface SynologyApiErrorObject {
    code: string;
}

interface SynologyApiRequestParams {
    api: string,
    version: number,
    method: string,
}

interface SynologyApiResponse<T> {
    data?: T;
    error?: SynologyApiErrorObject;
    success: boolean;
}

interface SynologyApiAuthResponse {
    sid?: string;
    did?: string;
}

interface SynologyApiListCamerasResponse {
    total: number;
    cameras: SynologyCamera[];
}

export interface SynologyCamera {
    firmware: string;
    id: number;
    model: string;
    newName: string;
    stream1?: SynologyCameraStream;
    stream2?: SynologyCameraStream;
    stream3?: SynologyCameraStream;
    vendor: string;
}

export interface SynologyCameraLiveViewPath {
    id: string;
    mjpegHttpPath: string;
    multicstPath: string;
    mxpegHttpPath: string;
    rtspOverHttpPath: string;
    rtspPath: string;
}

export interface SynologyCameraStream {
    id: string;
    fps?: number;
    resolution?: string;
    bitrateCtrl?: number;
    quality?: string;
    constantBitrate?: string;
}

export interface SynologyCameraInfoResponse {
    cameras: SynologyCameraInfo[];
}

export interface SynologyCameraInfo {
    id: string;
    stm_info: SynologyCameraInfoStream[];
}

export interface SynologyCameraInfoStream {
    camPath?: string;
    fps?: number;
    quality?: string;
    resolution?: string;
    stmNo?: number;
    type?: number;
}
