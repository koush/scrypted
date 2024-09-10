import net from 'net';
import fs from 'fs';
import os from 'os';
import sdk, { OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { httpFetch, httpFetchParseIncomingMessage } from '../../../server/src/fetch/http-fetch';

class DiagnosticsPlugin extends ScryptedDeviceBase implements Settings {
    storageSettings = new StorageSettings(this, {
        validateSystem: {
            title: 'Validate System',
            description: 'Validate the system configuration.',
            type: 'button',
            onPut: () => this.validateSystem(),
        },
        testDevice: {
            title: 'Test Device',
            type: 'device',
            deviceFilter: `type === '${ScryptedDeviceType.Camera}' || type === '${ScryptedDeviceType.Doorbell}'`,
            immediate: true,
        }
    });

    loggedMotion = new Map<string, number>();

    constructor(nativeId?: string) {
        super(nativeId);
        this.on = this.on || false;

        sdk.systemManager.listen((eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.MotionSensor)
                return;

            if (!eventData || !eventSource?.id)
                return;

            this.loggedMotion.set(eventSource.id, Date.now());
        });
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: any) {
        await this.storageSettings.putSetting(key, value);
    }

    async validate(stepName: string, step: Promise<any> | (() => Promise<any>)) {
        try {
            if (step instanceof Function)
                step = step();
            const result = await step;
            this.console.log(stepName.padEnd(24), `\x1b[32m ${result || 'OK'}\x1b[0m`);
        }
        catch (e) {
            this.console.error(stepName.padEnd(24), '\x1b[31m Failed\x1b[0m'.padEnd(24), (e as Error).message);
        }
    }

    async validateSystem() {
        this.console.log(''.padEnd(80, '='));
        this.console.log('System Validation');
        this.console.log(''.padEnd(80, '='));
        const nvrPlugin = sdk.systemManager.getDeviceById('@scrypted/nvr');
        const cloudPlugin = sdk.systemManager.getDeviceById('@scrypted/cloud');

        await this.validate('IPv4 Connectivity', httpFetch({
            url: 'https://jsonip.com',
            family: 4,
        }).then(() => { }));

        await this.validate('IPv6 Connectivity', httpFetch({
            url: 'https://jsonip.com',
            family: 6,
        }).then(() => { }));

        await this.validate('Scrypted Server Address', async () => {
            const addresses = await sdk.endpointManager.getLocalAddresses();
            const hasIPv4 = addresses.find(address => net.isIPv4(address));
            const hasIPv6 = addresses.find(address => net.isIPv6(address));
            if (!hasIPv4)
                throw new Error('Scrypted Settings IPv4 address not set.');
            if (!hasIPv6)
                throw new Error('Scrypted Settings IPv6 address not set.');
        });

        await this.validate('CPU Count', async () => {
            if (os.cpus().length < 2)
                throw new Error('CPU Count is too low. 4 CPUs are recommended.');
            return os.cpus().length;
        });

        await this.validate('Memory', async () => {
            if (os.totalmem() < 8 * 1024 * 1024 * 1024)
                throw new Error('Memory is too low. 8GB is recommended.');

            if (!nvrPlugin)
                return;

            if (os.totalmem() < 14 * 1024 * 1024 * 1024)
                throw new Error('Memory is too low. 16GB is recommended for NVR.');
            return Math.floor(os.totalmem() / 1024 / 1024 / 1024) + " GB";
        });

        if (process.platform === 'linux' && nvrPlugin) {
            // ensure /dev/dri/renderD128 is available
            await this.validate('GPU Passthrough', async () => {
                if (!fs.existsSync('/dev/dri/renderD128'))
                    throw new Error('GPU device unvailable or not passed through to container.');
            });
        }

        if (cloudPlugin) {
            await this.validate('Cloud Plugin', async () => {
                const logo = await httpFetch({
                    url: 'https://home.scrypted.app/_punch/web_hi_res_512.png',
                    responseType: 'buffer',
                });

                const mo = await sdk.mediaManager.createMediaObject(logo.body, 'image/png');
                const url = await sdk.mediaManager.convertMediaObjectToUrl(mo, 'image/png');

                const logoCheck = await httpFetch({
                    url,
                    responseType: 'buffer',
                });

                if (Buffer.compare(logo.body, logoCheck.body))
                    throw new Error('Invalid response received.');
            });
        }
    }
}

export default DiagnosticsPlugin;
