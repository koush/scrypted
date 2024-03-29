import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import https from 'https';

export const reolinkHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export async function getMotionState(credential: AuthFetchCredentialState, username: string, password: string, address: string, channelId: number) {
    const url = new URL(`http://${address}/api.cgi`);
    const params = url.searchParams;
    params.set('cmd', 'GetMdState');
    params.set('channel', channelId.toString());
    params.set('user', username);
    params.set('password', password);
    const response = await authHttpFetch({
        credential,
        url: url.toString(),
        rejectUnauthorized: false,
        responseType: 'json',
    });
    return {
        value: !!response.body?.[0]?.value?.state,
        data: response.body,
    };
}
