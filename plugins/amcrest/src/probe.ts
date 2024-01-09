import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import https from 'https';
import { TextParser } from '../../../server/src/http-fetch-helpers';

export const amcrestHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// appAutoStart=true
// deviceType=IP4M-1041B
// hardwareVersion=1.00
// processor=SSC327DE
// serialNumber=12345
// updateSerial=IPC-AW46WN-S2


// updateSerialCloudUpgrade=IPC-AW46WN-.....
export async function getDeviceInfo(credential: AuthFetchCredentialState, address: string) {
    const response = await authHttpFetch({
        credential,
        httpsAgent: amcrestHttpsAgent,
        url: `http://${address}/cgi-bin/magicBox.cgi?action=getSystemInfo`,
    }, undefined, TextParser);
    const lines = response.body.split('\n');
    const vals: {
        [key: string]: string,
    } = {};
    for (const line of lines) {
        let index = line.indexOf('=');
        if (index === -1)
            index = line.length;
        const k = line.substring(0, index);
        const v = line.substring(index + 1);
        vals[k] = v.trim();
    }

    return {
        deviceType: vals.deviceType,
        hardwareVersion: vals.hardwareVersion,
        serialNumber: vals.serialNumber,
    }
}
