import https from 'https';
import AxiosDigestAuth from '@koush/axios-digest-auth';

export const hikvisionHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export async function getDeviceInfo(digestAuth: AxiosDigestAuth, address: string) {
    try {
        const response = await digestAuth.request({
            httpsAgent: hikvisionHttpsAgent,
            method: "GET",
            responseType: 'text',
            url: `http://${address}/ISAPI/System/deviceInfo`,
        });
        const deviceModel = response.data.match(/>(.*?)<\/model>/)?.[1];
        const deviceName = response.data.match(/>(.*?)<\/deviceName>/)?.[1];
        const serialNumber = response.data.match(/>(.*?)<\/serialNumber>/)?.[1];
        const macAddress = response.data.match(/>(.*?)<\/macAddress>/)?.[1];
        const firmwareVersion = response.data.match(/>(.*?)<\/firmwareVersion>/)?.[1];
        return {
            deviceModel,
            deviceName,
            serialNumber,
            macAddress,
            firmwareVersion,
        };
    }
    catch (e) {
        if (e?.response?.data?.includes('notActivated'))
            throw new Error(`Camera must be first be activated at http://${address}.`)
        throw e;
    }
}
