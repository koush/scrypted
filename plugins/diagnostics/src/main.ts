import child_process from 'child_process';
import sharp from 'sharp';
import net from 'net';
import fs from 'fs';
import os from 'os';
import sdk, { Camera, MediaObject, MediaStreamDestination, MotionSensor, Notifier, OnOff, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { httpFetch, httpFetchParseIncomingMessage } from '../../../server/src/fetch/http-fetch';
import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import { Deferred } from '@scrypted/common/src/deferred';
class DiagnosticsPlugin extends ScryptedDeviceBase implements Settings {
    storageSettings = new StorageSettings(this, {
        testDevice: {
            group: 'Device',
            title: 'Validation Device',
            description: "Select a device to validate.",
            type: 'device',
            deviceFilter: `type === '${ScryptedDeviceType.Camera}' || type === '${ScryptedDeviceType.Doorbell}'  || type === '${ScryptedDeviceType.Notifier}'`,
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

    stepLogs: string[] = [];
    warnStep(result: string) {
        this.stepLogs.push(result);
    }

    async validate(stepName: string, step: Promise<any> | (() => Promise<any>)) {
        try {
            if (step instanceof Function)
                step = step();
            const result = await step;
            this.console.log(stepName.padEnd(24), `\x1b[32m ${result || 'OK'}\x1b[0m`);
            for (const log of this.stepLogs) {
                this.console.log(''.padEnd(24), `\x1b[33m ${log}\x1b[0m`);
            }
            this.stepLogs = [];
        }
        catch (e) {
            this.console.error(stepName.padEnd(24), '\x1b[31m Failed\x1b[0m'.padEnd(24), (e as Error).message);
        }
    }

    async validateDevice() {
        const device = this.storageSettings.values.testDevice as ScryptedDevice & any;

        this.console.log(''.padEnd(80, '='));
        this.console.log(`Device Validation: ${device?.name}`);
        this.console.log(''.padEnd(80, '='));

        await this.validate('Device Selected', async () => {
            if (!device)
                throw new Error('Select a device in the Settings UI.');
        });

        if (!device)
            return;

        if (device.type === ScryptedDeviceType.Camera || device.type === ScryptedDeviceType.Doorbell) {
            await this.validateCamera(device);
        }
        else if (device.type === ScryptedDeviceType.Notifier) {
            await this.validateNotifier(device);
        }

        this.console.log(''.padEnd(80, '='));
        this.console.log(`Device Validation Complete: ${device?.name}`);
        this.console.log(''.padEnd(80, '='));
    }

    async validateNotifier(device: ScryptedDevice & Notifier) {
        await this.validate('Test Notification', async () => {
            const logo = await httpFetch({
                url: 'https://home.scrypted.app/_punch/web_hi_res_512.png',
                responseType: 'buffer',
            });

            const mo = await sdk.mediaManager.createMediaObject(logo.body, 'image/png');
            await device.sendNotification('Scrypted Diagnostics', {
                body: 'Body',
                subtitle: 'Subtitle',
            }, mo);

            this.warnStep('Check the device for the notification.');
        });
    }

    async validateCamera(device: ScryptedDevice & Camera & VideoCamera & MotionSensor) {
        await this.validate('Device Capabilities', async () => {
            if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
                throw new Error('Motion Sensor not found.');

            if (device.type === ScryptedDeviceType.Doorbell && !device.interfaces.includes(ScryptedInterface.BinarySensor))
                throw new Error('Doorbell button not found.');
        });

        await this.validate('Motion Detection', async () => {
            if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
                throw new Error('Motion Sensor not found. Enabling a software motion sensor extension is recommended.');

            if (device.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
                if (device.interfaces.find(i => i.startsWith('ObjectDetection:true')))
                    this.warnStep('Camera hardware provides motion events, but a software motion detector is enabked. Consider disabling the software motion detector.');
            }
        });

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            await this.validate('Recent Motion', async () => {

                const lastMotion = this.loggedMotion.get(device.id);
                if (!lastMotion)
                    throw new Error('No recent motion detected. Go wave your hand in front of the camera.');
                if (Date.now() - lastMotion > 8 * 60 * 60 * 1000)
                    throw new Error('Last motion was over 8 hours ago.');
            });
        }


        if (device.type === ScryptedDeviceType.Doorbell) {
            await this.validate('Recent Button Press', async () => {
                const lastButton = this.loggedButton.get(device.id);
                if (!lastButton)
                    throw new Error('No recent button press detected. Go press the doorbell button.');
                if (Date.now() - lastButton > 8 * 60 * 60 * 1000)
                    throw new Error('Last button press was over 8 hours ago.');
            });
        }

        const validateMedia = async (stepName: string, mo: Promise<MediaObject>, snapshot = false, and?: () => Promise<void>) => {
            await this.validate(stepName, async () => {
                if (snapshot && !device.interfaces.includes(ScryptedInterface.Camera))
                    throw new Error('Snapshot not supported. Enable the Snapshot extension.');
                const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(await mo, 'image/jpeg');
                const metadata = await sharp(jpeg).metadata();
                if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100)
                    throw new Error('Malformed image.');
                if (!and && snapshot && device.pluginId === '@scrypted/unifi-protect' && metadata.width < 1280)
                    this.warnStep('Unifi Protect provides low quality snapshots. Consider using Snapshot from Prebuffer for full resolution screenshots.');
                await and?.();
            });
        };

        await validateMedia('Snapshot', device.takePicture({
            reason: 'event',
        }), true);

        await this.validate('Streams', async () => {
            const vsos = await device.getVideoStreamOptions();

            if (!vsos?.length)
                throw new Error('Stream configuration invalid.');

            if (vsos.length < 3)
                this.warnStep(`Camera has ${vsos.length} substream. Three streams are recommended.`);

            const cloudStreams = vsos.filter(vso => vso.source === 'cloud');
            if (cloudStreams.length)
                this.warnStep(`Cloud camera. Upgrade recommended.`);

            const usedStreams = vsos.filter(vso => vso.destinations?.length);
            if (usedStreams.length < Math.min(3, vsos.length))
                this.warnStep(`Unused streams detected.`);
        });

        const getVideoStream = async (destination: MediaStreamDestination) => {
            if (!device.interfaces.includes(ScryptedInterface.VideoCamera))
                throw new Error('Streaming not supported.');
            return await device.getVideoStream({
                destination,
                prebuffer: 0,
            });
        };

        const validated = new Set<string | undefined>();
        const validateMediaStream = async (stepName: string, destination: MediaStreamDestination) => {
            const vsos = await device.getVideoStreamOptions();
            const streamId = vsos.find(vso => vso.destinations?.includes(destination))?.id;

            if (validated.has(streamId)) {
                await this.validate(stepName, async () => "Skipped (Duplicate)");
                return;
            }

            validated.add(streamId);

            await validateMedia(stepName, getVideoStream(destination));
            const start = Date.now();
            await validateMedia(stepName + ' (IDR)', getVideoStream(destination), false, async () => {
                const end = Date.now();
                if (end - start > 5000)
                    throw new Error(`High IDR Interval. This may cause issues with HomeKit Secure Video. Adjust codec configuration if possible.`);
            });
        };

        await validateMediaStream('Local', 'local');

        await validateMediaStream('Local Recorder', 'local-recorder');

        await validateMediaStream('Remote Recorder', 'remote-recorder');

        await validateMediaStream('Remote', 'remote');

        await validateMediaStream('Low Resolution', 'low-resolution');

        await this.validate('Audio Codecs', async () => {
            const vsos = await device.getVideoStreamOptions();

            let codec: string | undefined;
            const codecs = new Set<string>();
            for (const vso of vsos) {
                if (vso.audio?.codec) {
                    codec = vso.audio.codec;
                    codecs.add(vso.audio.codec);
                }
            }

            if (codecs.size > 1) {
                this.warnStep(`Mismatched audio codecs detected.`);
                return;
            }

            if (!codec)
                return;

            if (codec !== 'pcm_mulaw' && codec !== 'aac' && codec !== 'opus') {
                this.warnStep(`Audio codec is ${codec}. pcm_mulaw, aac, or opus is recommended.`);
                return;
            }
        });
    }

    async validateSystem() {
        this.console.log(''.padEnd(80, '='));
        this.console.log('System Validation');
        this.console.log(''.padEnd(80, '='));

        const nvrPlugin = sdk.systemManager.getDeviceById('@scrypted/nvr');
        const cloudPlugin = sdk.systemManager.getDeviceById('@scrypted/cloud');
        const openvinoPlugin = sdk.systemManager.getDeviceById<Settings>('@scrypted/openvino');

        await this.validate('Scrypted Installation', async () => {
            const e = process.env.SCRYPTED_INSTALL_ENVIRONMENT;
            if (process.platform !== 'linux') {
                if (e !== 'electron')
                    this.warnStep('Upgrading to the Scrypted Desktop application is recommened for Windows and macOS.');
                return;
            }

            if (e !== 'docker' && e !== 'lxc')
                throw new Error('Unrecognized Linux installation. Installation via Docker image or the official Proxmox LXC script is recommended.');
        });

        await this.validate('IPv4 Check (jsonip.com)', httpFetch({
            url: 'https://jsonip.com',
            family: 4,
            responseType: 'json',
        }).then(r => r.body.ip));

        await this.validate('IPv6 Check (jsonip.com)', httpFetch({
            url: 'https://jsonip.com',
            family: 6,
            responseType: 'json',
        }).then(r => r.body.ip));

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

        if (openvinoPlugin) {
            await this.validate('OpenVINO Plugin', async () => {
                const settings = await openvinoPlugin.getSettings();
                const availbleDevices = settings.find(s => s.key === 'available_devices');
                if (!availbleDevices?.value?.toString().includes('GPU'))
                    throw new Error('GPU device unvailable or not passed through to container.');
            });
        }

        if (nvrPlugin) {
            await this.validate("GPU Decode", async () => {
                const ffmpegPath = await sdk.mediaManager.getFFmpegPath();
                const args = [
                    '-y',
                    '-hwaccel', 'auto',
                    '-i', 'https://github.com/koush/scrypted-sample-cameraprovider/raw/main/fs/dog.mp4',
                    '-f', 'rawvideo',
                    'pipe:3',
                ];
                const cp = child_process.spawn(ffmpegPath, args, {
                    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
                });

                const deferred = new Deferred<void>();
                deferred.promise.catch(() => { }).finally(() => safeKillFFmpeg(cp));
                cp.stdio[3]?.on('data', () => { });

                cp.stderr!.on('data', data => {
                    const str = data.toString();
                    if (str.includes('nv12'))
                        deferred.resolve();
                });

                setTimeout(() => {
                    deferred.reject(new Error('GPU Decode failed.'));
                }, 5000);

                await deferred.promise;
            });
        }

        this.console.log(''.padEnd(80, '='));
        this.console.log('System Validation Complete');
        this.console.log(''.padEnd(80, '='));
    }
}

export default DiagnosticsPlugin;
