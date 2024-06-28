import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import https from 'https';
import { httpFetch } from '../../../server/src/fetch/http-fetch';

export const reolinkHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});


export async function getLoginToken(host: string, username: string, password: string) {
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
    return {
        token,
        body: response.body,
    }
}
