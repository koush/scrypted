import https from 'https';

export const amcrestHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// appAutoStart=true
// deviceType=IP4M-1041B
// hardwareVersion=1.00
// processor=SSC327DE
// serialNumber=12345
// updateSerial=IPC-AW46WN-S2

import AxiosDigestAuth from "@koush/axios-digest-auth";

// updateSerialCloudUpgrade=IPC-AW46WN-.....
export async function getDeviceInfo(digestAuth: AxiosDigestAuth, address: string) {
    const response = await digestAuth.request({
        httpsAgent: amcrestHttpsAgent,
        method: "GET",
        responseType: 'text',
        url: `http://${address}/cgi-bin/magicBox.cgi?action=getSystemInfo`,
    });
    const lines = (response.data as string).split('\n');
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
