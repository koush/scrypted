import sharp from 'sharp';
import net from 'net';
import fs from 'fs';
import os from 'os';
import sdk, { Camera, MediaObject, MotionSensor, OnOff, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { httpFetch, httpFetchParseIncomingMessage } from '../../../server/src/fetch/http-fetch';

class DiagnosticsPlugin extends ScryptedDeviceBase implements Settings {
    storageSettings = new StorageSettings(this, {
        testDevice: {
            group: 'Device',
            title: 'Test Device',
            type: 'device',
            deviceFilter: `type === '${ScryptedDeviceType.Camera}' || type === '${ScryptedDeviceType.Doorbell}'`,
            immediate: true,
        },
        validateDevice: {
            console: true,
            group: 'Device',
            title: 'Validate Device',
            description: 'Validate the device configuration.',
            type: 'button',
            onPut: async () => {
                this.validateDevice();
            },
        },
        validateSystem: {
            console: true,
            group: 'System',
            title: 'Validate System',
            description: 'Validate the system configuration.',
            type: 'button',
            onPut: () => this.validateSystem(),
        },
    });

    loggedMotion = new Map<string, number>();
    loggedButton = new Map<string, number>();

    constructor(nativeId?: string) {
        super(nativeId);
        this.on = this.on || false;

        sdk.systemManager.listen((eventSource, eventDetails, eventData) => {
            if (!eventData || !eventSource?.id)
                return;

            if (eventDetails.eventInterface === ScryptedInterface.MotionSensor) {
                this.loggedMotion.set(eventSource.id, Date.now());
                return;
            }

            if (eventDetails.eventInterface === ScryptedInterface.BinarySensor) {
                this.loggedButton.set(eventSource.id, Date.now());
                return;
            }
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

    async validateDevice() {
        const device = this.storageSettings.values.testDevice as ScryptedDevice & Camera & VideoCamera & MotionSensor;

        this.console.log(''.padEnd(80, '='));
        this.console.log(`Device Validation: ${device?.name}`);
        this.console.log(''.padEnd(80, '='));

        await this.validate('Device Selected', async () => {
            if (!device)
                throw new Error('Select a device in the Settings UI.');
        });

        if (!device)
            return;

        await this.validate('Device Capabilities', async () => {
            if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
                throw new Error('Motion Sensor not found.');

            if (device.type === ScryptedDeviceType.Doorbell && !device.interfaces.includes(ScryptedInterface.BinarySensor))
                throw new Error('Doorbell button not found.');
        });

        await this.validate('Recent Motion', async () => {
            const lastMotion = this.loggedMotion.get(device.id);
            if (!lastMotion)
                throw new Error('No recent motion detected. Go wave your hand in front of the camera.');
            if (Date.now() - lastMotion > 8 * 60 * 60 * 1000)
                throw new Error('Last motion was over 8 hours ago.');
        });

        if (device.type === ScryptedDeviceType.Doorbell) {
            await this.validate('Recent Button Press', async () => {
                const lastButton = this.loggedButton.get(device.id);
                if (!lastButton)
                    throw new Error('No recent button press detected. Go press the doorbell button.');
                if (Date.now() - lastButton > 8 * 60 * 60 * 1000)
                    throw new Error('Last button press was over 8 hours ago.');
            });
        }

        const validateMedia = async (stepName: string, mo: MediaObject) => {
            await this.validate(stepName, async () => {
                const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg');
                const metadata = await sharp(jpeg).metadata();
                if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100)
                    throw new Error('Malformed image.');
            })
        };

        await validateMedia('Snapshot', await device.takePicture({
            reason: 'event',
        }));

        await validateMedia('Local Stream', await device.getVideoStream({
            destination: 'local',
        }));

        await validateMedia('Local Recorder Stream', await device.getVideoStream({
            destination: 'local-recorder',
        }));

        await validateMedia('Remote Recorder Stream', await device.getVideoStream({
            destination: 'remote-recorder',
        }));

        await validateMedia('Remote Stream', await device.getVideoStream({
            destination: 'remote',
        }));

        await validateMedia('Low Resolution Stream', await device.getVideoStream({
            destination: 'low-resolution',
        }));

        this.console.log(''.padEnd(80, '='));
        this.console.log(`Device Validation Complete: ${device?.name}`);
        this.console.log(''.padEnd(80, '='));
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
            if (!nvrPlugin) {
                if (os.totalmem() < 8 * 1024 * 1024 * 1024)
                    throw new Error('Memory is too low. 8GB is recommended.');
                return;
            }

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

        this.console.log(''.padEnd(80, '='));
        this.console.log('System Validation Complete');
        this.console.log(''.padEnd(80, '='));
    }
}

export default DiagnosticsPlugin;
