import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Battery, DeviceDiscovery, DeviceProvider, Dock, OnOff, Pause, Refresh, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, StartStop } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/common/src/settings";
import qs from 'query-string';
import crypto from 'crypto';
import throttle from 'lodash/throttle';

const rc4 = require('arc4');


const { log, deviceManager } = sdk;

function generateAgent() {
    // 13 characters between A and E.
    let agent = '';
    for (let i = 0; i < 13; i++) {
        const r = Math.floor(Math.random() * 5);
        const c = String.fromCharCode('A'.charCodeAt(0) + r);
        agent += c;
    }
    return agent;
}

function generateDeviceId() {
    // 13 characters between A and E.
    let agent = '';
    for (let i = 0; i < 13; i++) {
        const r = Math.floor(Math.random() * 26);
        const c = String.fromCharCode('a'.charCodeAt(0) + r);
        agent += c;
    }
    return agent;
}

function apiToJson(data: string) {
    return JSON.parse(data.replace('&&&START&&&', ''));
}

function generateEncSignature(url: string, method: string, signedNonce: string, parans: any) {
    const signatureParams = [
        method.toUpperCase(),
        url.split("com")[1].replace("/app/", "/")
    ];
    for (const [k, v] of Object.entries(parans)) {
        signatureParams.push(`${k}=${v}`);
    }
    signatureParams.push(signedNonce);
    const signature = signatureParams.join('&');
    return crypto.createHash('sha1').update(signature).digest().toString('base64');
}

function encryptRc4(password: string, payload: string) {
    const r = rc4('arc4', Buffer.from(password, 'base64'));
    const e: Buffer = r.encodeBuffer(Buffer.concat([Buffer.alloc(1024), Buffer.from(payload)]));
    const s = e.slice(1024);
    return s.toString('base64');
}

function decryptRc4(password: string, payload: string) {
    const r = rc4('arc4', Buffer.from(password, 'base64'));
    const b: Buffer = r.encodeBuffer(Buffer.concat([Buffer.alloc(1024), Buffer.from(payload, 'base64')]));
    return b.slice(1024).toString();
}

function generateEncParams(url: string, method: string, signedNonce: string, nonce: string, params: any, ssecurity: string) {
    params['rc4_hash__'] = generateEncSignature(url, method, signedNonce, params)
    for (const [k, v] of Object.entries(params)) {
        params[k] = encryptRc4(signedNonce, v as string);
    }
    params.signature = generateEncSignature(url, method, signedNonce, params);
    params.ssecurity = ssecurity;
    params._nonce = nonce;
    return params
}

function createSignedNonce(ssecurity: string, nonce: string) {
    return crypto.createHash('sha256')
        .update(Buffer.from(ssecurity, 'base64'))
        .update(Buffer.from(nonce, 'base64'))
        .digest().toString('base64');
}

const miio = require('../homebridge-xiaomi-roborock-vacuum/miio');
const agent = `Android-7.1.1-1.0.0-ONEPLUS A3010-136-${generateAgent()} APP/xiaomi.smarthome APPV/62830`;
const deviceId = generateDeviceId();

const jar = new CookieJar();


jar.setCookie("sdkVersion=accountsdk-18.8.15", 'http://mi.com');
jar.setCookie("sdkVersion=accountsdk-18.8.15", 'http://xiaomi.com');
jar.setCookie(`deviceId=${deviceId}`, 'http://mi.com');
jar.setCookie(`deviceId=${deviceId}`, 'http://xiaomi.com');

class RoborockVacuum extends ScryptedDeviceBase implements StartStop, Pause, Dock, Refresh, Battery {
    storageSettings = new StorageSettings(this, {
        ip: {
            title: 'IP Address',
            description: 'The address of the device.',
        },
        token: {
            title: 'Token',
            description: 'The token used to authenticate with the device.',
        },
    });

    refreshThrottled = throttle(() => {
        this.refresh(undefined, undefined);
    }, 10000);

    constructor(nativeId: string) {
        super(nativeId);
    }

    async getRefreshFrequency() {
        return 30;
    }

    async pollChanges() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            this.refreshThrottled();
        }
    }

    async refresh(refreshInterface: string, userInitiated: boolean) {
        const device = await this.findDevice();
        const state = await device.state();
        this.running = !state.charging || state.cleaning;
        this.docked = state.charging;
        this.paused = !state.charging && !state.cleaning;
        this.batteryLevel = state.batteryLevel;
    }

    async findDevice() {
        return await miio.device({
            address: this.storageSettings.values.ip,
            token: this.storageSettings.values.token,
        });
    }

    async start() {
        const device = await this.findDevice();
        await device.activateCleaning();
        this.pollChanges();
    }
    async stop() {
        const device = await this.findDevice();
        await device.deactivateCleaning();
        this.pollChanges();
    }
    async pause() {
        const device = await this.findDevice();
        await device.pause();
        this.pollChanges();
    }
    async resume() {
        const device = await this.findDevice();
        await device.activateCleaning();
        this.pollChanges();
    }
    async dock() {
        const device = await this.findDevice();
        await device.activateCharging();
        this.pollChanges();
    }
}

class RoborockPlugin extends ScryptedDeviceBase implements DeviceDiscovery, DeviceProvider, Settings {
    storageSettings = new StorageSettings(this, {
        userId: {
            title: 'User ID or Email',
            description: 'The numberical User ID or email for your Mi Home account.',
            onPut: () => this.discoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: () => this.discoverDevices(),
        }
    });
    step2Json: any;
    step3Json: any;
    devices = new Map<string, RoborockVacuum>();

    constructor() {
        super();

        this.discoverDevices();
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
    putSetting(key: string, value: SettingValue) {
        return this.storageSettings.putSetting(key, value);
    }

    async discoverDevices(duration?: number) {
        if (!this.storageSettings.values.userId || !this.storageSettings.values.password) {
            this.log.a('Enter your User ID and Password to discover your Roborock Vacuums.');
            return;
        }
        const client = wrapper(axios.create({ jar }));

        const step1 = await client('https://account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true', {
            headers: {
                'User-Agent': agent,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': `userId=${this.storageSettings.values.userId}`,
            },
        })

        const step1Json = apiToJson(step1.data);
        this.console.log('login step 1', step1Json);


        const step2Data = qs.stringify({
            "sid": "xiaomiio",
            "hash": crypto.createHash('md5').update(this.storageSettings.values.password).digest().toString('hex').toUpperCase(),
            "callback": "https://sts.api.io.mi.com/sts",
            "qs": "%3Fsid%3Dxiaomiio%26_json%3Dtrue",
            "user": this.storageSettings.values.userId,
            "_sign": step1Json._sign,
            "_json": "true"
        })

        const step2 = await client.post('https://account.xiaomi.com/pass/serviceLoginAuth2', step2Data, {
            headers: {
                'User-Agent': agent,
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        })

        this.step2Json = apiToJson(step2.data);
        this.console.log('login step 2', this.step2Json);

        if (!this.step2Json.ssecurity)
            throw new Error('login missing: ssecurity');
        if (this.step2Json.ssecurity.length < 4) {
            const { notificationUrl } = this.step2Json;
            if (notificationUrl) {
                this.log.a('Two factor authentication is required. Open the following url and reload the plugin: ' + notificationUrl)
                this.console.error('Two factor authentication is required. Open the following url and reload the plugin: ' + notificationUrl)
                this.console.error(notificationUrl);
            }
            throw new Error('login failure');
        }

        const step3 = await client(this.step2Json.location, {
            headers: {
                'User-Agent': agent,
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        this.console.log('login step 3', step3.data);
        this.step3Json = step3.data;
        const serviceToken = (await jar.getCookies(this.step2Json.location)).find(cookie => cookie.key === 'serviceToken').value;
        this.console.log('service token', serviceToken);

        const servers = ["cn", "de", "us", "ru", "tw", "sg", "in", "i2"];

        for (const server of servers) {
            try {
                const subdomain = server === 'cn' ? '' : server + '.';
                const url = `https://${subdomain}api.io.mi.com/app/home/device_list`;

                const minutes = Math.floor(Date.now() / 60000);
                const minutesBuffer = Buffer.alloc(4);
                minutesBuffer.writeInt32BE(minutes, 0);
                const nonce = Buffer.concat([crypto.randomBytes(8), minutesBuffer]).toString('base64');
                const signedNonce = createSignedNonce(this.step2Json.ssecurity, nonce);

                const params = {
                    "data": '{"getVirtualModel":true,"getHuamiDevices":1,"get_split_device":false,"support_smart_home":true}'
                }

                const fields = generateEncParams(url, 'POST', signedNonce, nonce, params, this.step2Json.ssecurity);

                jar.setCookie(`userId=${this.storageSettings.values.userId}`, url);
                jar.setCookie(`yetAnotherServiceToken=${serviceToken}`, url);
                jar.setCookie(`serviceToken=${serviceToken}`, url);
                jar.setCookie(`locale=en_GB`, url);
                jar.setCookie(`timezone=GMT+02:00`, url);
                jar.setCookie(`is_daylight=1`, url);
                jar.setCookie(`dst_offset=3600000`, url);
                jar.setCookie(`channel=MI_APP_STORE`, url);



                jar.setCookie("sdkVersion=accountsdk-18.8.15", url);
                jar.setCookie(`deviceId=${deviceId}`, url);

                const client = wrapper(axios.create({ jar }));

                const devicesResponse = await client.post(url, qs.stringify(fields), {
                    headers: {
                        "Accept-Encoding": "identity",
                        "User-Agent": agent,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "x-xiaomi-protocal-flag-cli": "PROTOCAL-HTTP2",
                        "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
                    }
                });

                this.console.log(devicesResponse.data);
                const decoded = decryptRc4(signedNonce, devicesResponse.data);
                const devices = JSON.parse(decoded);
                this.console.log(devices);

                for (const device of devices.result.list) {
                    if (!device.model?.includes('vacuum'))
                        continue;
                    const id = await deviceManager.onDeviceDiscovered({
                        name: device.name,
                        type: ScryptedDeviceType.Vacuum,
                        nativeId: device.mac,
                        interfaces: [
                            ScryptedInterface.Refresh,
                            ScryptedInterface.Battery,
                            ScryptedInterface.StartStop,
                            ScryptedInterface.Pause,
                            ScryptedInterface.Dock,
                        ],
                        info: {
                            model: device.model,
                            manufacturer: 'Roborock',
                            serialNumber: device.mac,
                        },
                    });
                    const vacuum = this.getDevice(device.mac);
                    vacuum.storageSettings.values.token = device.token;
                    vacuum.storageSettings.values.ip = device.localip;
                }
            }
            catch (e) {
                this.console.error('error retrieving devices from server', server);
            }
        }
    }

    getDevice(nativeId: string) {
        let vacuum = this.devices.get(nativeId);
        if (!vacuum) {
            vacuum = new RoborockVacuum(nativeId);
            this.devices.set(vacuum.nativeId, vacuum);
        }
        return vacuum;
    }
}

export default new RoborockPlugin();
