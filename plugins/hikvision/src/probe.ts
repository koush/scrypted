import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { checkStatus } from '../../../server/src/fetch';

export async function getDeviceInfo(credential: AuthFetchCredentialState, address: string) {
    const response = await authHttpFetch({
        credential,
        url: `http://${address}/ISAPI/System/deviceInfo`,
        checkStatusCode: false,
        responseType: 'text',
        rejectUnauthorized: false,
    });

    if (response.body.includes('notActivated'))
        throw new Error(`Camera must be first be activated at http://${address}.`);

    checkStatus(response.statusCode);

    const deviceModel = response.body.match(/>(.*?)<\/model>/)?.[1];
    const deviceName = response.body.match(/>(.*?)<\/deviceName>/)?.[1];
    const serialNumber = response.body.match(/>(.*?)<\/serialNumber>/)?.[1];
    const macAddress = response.body.match(/>(.*?)<\/macAddress>/)?.[1];
    const firmwareVersion = response.body.match(/>(.*?)<\/firmwareVersion>/)?.[1];
    return {
        deviceModel,
        deviceName,
        serialNumber,
        macAddress,
        firmwareVersion,
    };
}
