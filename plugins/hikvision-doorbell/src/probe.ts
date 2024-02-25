import { checkStatus } from '../../../server/src/fetch';
import { AuthRequst } from './auth-request'


export async function getDeviceInfo(auth: AuthRequst, address: string) {

    const response = await auth.request (`http://${address}/ISAPI/System/deviceInfo`, {responseType: 'text'});

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
