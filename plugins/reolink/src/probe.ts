import https from 'https';
import { httpFetch } from '../../../server/src/fetch/http-fetch';

export const reolinkHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

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

async function getDeviceInfoInternal(host: string, parameters: Record<string, string>): Promise<DevInfo> {
    const url = new URL(`http://${host}/api.cgi`);
    const params = url.searchParams;
    params.set('cmd', 'GetDevInfo');
    for (const [key, value] of Object.entries(parameters)) {
        params.set(key, value);
    }

    const response = await httpFetch({
        url,
        responseType: 'json',
    });

    const error = response.body?.[0]?.error;
    if (error)
        throw new Error('error during call to getDeviceInfo');

    const ret: DevInfo = response.body?.[0]?.value?.DevInfo;
    if (!ret?.type && !ret?.model && !ret?.exactType)
        throw new Error('device info return unexpected data');
    return ret;
}

export async function getDeviceInfo(host: string, username: string, password: string): Promise<DevInfo> {
    const parameters = await getLoginParameters(host, username, password);
    return getDeviceInfoInternal(host, parameters.parameters);
}

export async function getLoginParameters(host: string, username: string, password: string, forceToken?: boolean) {
    if (!forceToken) {
        try {
            await getDeviceInfoInternal(host, {
                user: username,
                password,
            });
            return {
                parameters: {
                    user: username,
                    password,
                },
                leaseTimeSeconds: Infinity,
            }
        }
        catch (e) {
        }
    }

    try {
        const url = new URL(`http://${host}/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Login');

        const response = await httpFetch({
            url,
            method: 'POST',
            responseType: 'json',
            rejectUnauthorized: false,
            body: [
                {
                    cmd: 'Login',
                    action: 0,
                    param: {
                        User: {
                            userName: username,
                            password: password
                        }
                    }
                },
            ],
        });

        const token = response.body?.[0]?.value?.Token?.name || response.body?.value?.Token?.name;
        if (!token)
            throw new Error('unable to login');
        const { body } = response;
        const leaseTimeSeconds: number = body?.[0]?.value?.Token.leaseTime || body?.value?.Token.leaseTime;
        return {
            parameters: {
                token,
            },
            leaseTimeSeconds,
        }
    }
    catch (e) {
        // if the token exchange fails, fall back to basic auth
        // TODO: maybe detect error type?
        return {
            parameters: {
                user: username,
                password,
            },
            leaseTimeSeconds: 60,
        }
    }
}
