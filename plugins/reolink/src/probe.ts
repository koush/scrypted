import AxiosDigestAuth from "@koush/axios-digest-auth";
import https from 'https';

export const reolinkHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export async function getMotionState(digestAuth: AxiosDigestAuth, username: string, password: string, address: string, channelId: number) {
    const url = new URL(`http://${address}/cgi-bin/api.cgi`);
    const params = url.searchParams;
    params.set('cmd', 'GetMdState');
    params.set('channel', channelId.toString());
    params.set('user', username);
    params.set('password', password);
    const response = await digestAuth.request({
        url: url.toString(),
        httpsAgent: reolinkHttpsAgent,
    });
    return {
        value: !!response.data?.[0]?.value?.state,
        data: response.data,
    };
}
