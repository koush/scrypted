import { Deferred } from '@scrypted/common/src/deferred';
import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import sdk, { Camera, FFmpegInput, Image, MediaObject, MediaStreamDestination, MotionSensor, Notifier, ObjectDetection, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import sharp from 'sharp';
import { httpFetch } from '../../../server/src/fetch/http-fetch';
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

    warnStep(console: Console, result: string) {
        console.log(''.padEnd(24), `\x1b[33m${result}\x1b[0m`);
    }

    async validate(console: Console, stepName: string, step: Promise<any> | (() => Promise<any>)) {
        try {
            if (step instanceof Function)
                step = step();
            console.log(stepName.padEnd(24), '\x1b[34mRunning\x1b[0m');
            const result = await step;
            console.log(''.padEnd(24), `\x1b[32m${result || 'OK'}\x1b[0m`);
        }
        catch (e) {
            console.error(stepName.padEnd(24), '\x1b[31m Failed\x1b[0m'.padEnd(24), (e as Error).message);
        }
    }

    async validateDevice() {
        const device = this.storageSettings.values.testDevice as ScryptedDevice & any;
        const console = sdk.deviceManager.getMixinConsole(device.id);

        console.log(''.padEnd(44, '='));
        console.log(`Device Validation: ${device?.name}`);
        console.log(''.padEnd(44, '='));

        await this.validate(console, 'Device Selected', async () => {
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

        console.log(''.padEnd(44, '='));
        console.log(`Device Validation Complete: ${device?.name}`);
        console.log(''.padEnd(44, '='));
    }

    async validateNotifier(device: ScryptedDevice & Notifier) {
        const console = sdk.deviceManager.getMixinConsole(device.id);

        await this.validate(console, 'Test Notification', async () => {
            const logo = await httpFetch({
                url: 'https://home.scrypted.app/_punch/web_hi_res_512.png',
                responseType: 'buffer',
            });

            const mo = await sdk.mediaManager.createMediaObject(logo.body, 'image/png');
            await device.sendNotification('Scrypted Diagnostics', {
                body: 'Body',
                subtitle: 'Subtitle',
                android: {
                    channel: 'diagnostics',
                }
            }, mo);

            this.warnStep(console, 'Check the device for the notification.');
        });
    }

    async validateCamera(device: ScryptedDevice & Camera & VideoCamera & MotionSensor) {
        const console = sdk.deviceManager.getMixinConsole(device.id);

        await this.validate(console, 'Device Capabilities', async () => {
            if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
                throw new Error('Motion Sensor not found.');

            if (device.type === ScryptedDeviceType.Doorbell && !device.interfaces.includes(ScryptedInterface.BinarySensor))
                throw new Error('Doorbell button not found.');
        });

        await this.validate(console, 'Motion Detection', async () => {
            if (!device.interfaces.includes(ScryptedInterface.MotionSensor))
                throw new Error('Motion Sensor not found. Enabling a software motion sensor extension is recommended.');

            if (device.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
                if (device.interfaces.find(i => i.startsWith('ObjectDetection:true')))
                    this.warnStep(console, 'Camera hardware provides motion events, but a software motion detector is enabled. Consider disabling the software motion detector.');
            }
        });

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            await this.validate(console, 'Recent Motion', async () => {

                const lastMotion = this.loggedMotion.get(device.id);
                if (!lastMotion)
                    throw new Error('No recent motion detected. Go wave your hand in front of the camera.');
                if (Date.now() - lastMotion > 8 * 60 * 60 * 1000)
                    throw new Error('Last motion was over 8 hours ago.');
            });
        }


        if (device.type === ScryptedDeviceType.Doorbell) {
            await this.validate(console, 'Recent Button Press', async () => {
                const lastButton = this.loggedButton.get(device.id);
                if (!lastButton)
                    throw new Error('No recent button press detected. Go press the doorbell button.');
                if (Date.now() - lastButton > 8 * 60 * 60 * 1000)
                    throw new Error('Last button press was over 8 hours ago.');
            });
        }

        const validateMedia = async (stepName: string, mo: Promise<MediaObject>, snapshot = false, and?: () => Promise<void>) => {
            await this.validate(console, stepName, async () => {
                if (snapshot && !device.interfaces.includes(ScryptedInterface.Camera))
                    throw new Error('Snapshot not supported. Enable the Snapshot extension.');
                const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(await mo, 'image/jpeg');
                const metadata = await sharp(jpeg).metadata();
                if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100)
                    throw new Error('Malformed image.');
                if (!and && snapshot && device.pluginId === '@scrypted/unifi-protect' && metadata.width < 1280)
                    this.warnStep(console, 'Unifi Protect provides low quality snapshots. Consider using Snapshot from Prebuffer for full resolution screenshots.');
                await and?.();
            });
        };

        await validateMedia('Snapshot', device.takePicture({
            reason: 'event',
        }), true);

        await this.validate(console, 'Streams', async () => {
            const vsos = await device.getVideoStreamOptions();

            if (!vsos?.length)
                throw new Error('Stream configuration invalid.');

            if (vsos.length < 3)
                this.warnStep(console, `Camera has ${vsos.length} substream. Three streams are recommended.`);

            const cloudStreams = vsos.filter(vso => vso.source === 'cloud');
            if (cloudStreams.length)
                this.warnStep(console, `Cloud camera. Upgrade recommended.`);

            const usedStreams = vsos.filter(vso => vso.destinations?.length);
            if (usedStreams.length < Math.min(3, vsos.length))
                this.warnStep(console, `Unused streams detected.`);
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
                await this.validate(console, stepName, async () => "Skipped (Duplicate)");
                return;
            }

            validated.add(streamId);

            const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(await getVideoStream(destination), ScryptedMimeTypes.FFmpegInput);
            if (ffmpegInput.mediaStreamOptions?.video?.codec !== 'h264')
                this.warnStep(console, `Stream ${stepName} is using codec ${ffmpegInput.mediaStreamOptions?.video?.codec}. h264 is recommended.`);

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

        await this.validate(console, 'Audio Codecs', async () => {
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
                this.warnStep(console, `Mismatched audio codecs detected.`);
                return;
            }

            if (!codec)
                return;

            if (codec !== 'pcm_mulaw' && codec !== 'aac' && codec !== 'opus') {
                this.warnStep(console, `Audio codec is ${codec}. pcm_mulaw, aac, or opus is recommended.`);
                return;
            }
        });
    }

    async validateSystem() {
        this.console.log(''.padEnd(44, '='));
        this.console.log('System Validation');
        this.console.log(''.padEnd(44, '='));

        const nvrPlugin = sdk.systemManager.getDeviceById('@scrypted/nvr');
        const cloudPlugin = sdk.systemManager.getDeviceById('@scrypted/cloud');
        const hasCUDA = process.env.NVIDIA_VISIBLE_DEVICES && process.env.NVIDIA_DRIVER_CAPABILITIES;
        const onnxPlugin = sdk.systemManager.getDeviceById<Settings & ObjectDetection>('@scrypted/onnx');
        const openvinoPlugin = sdk.systemManager.getDeviceById<Settings & ObjectDetection>('@scrypted/openvino');

        await this.validate(this.console, 'Scrypted Installation', async () => {
            const e = process.env.SCRYPTED_INSTALL_ENVIRONMENT;
            if (process.platform !== 'linux') {
                if (e !== 'electron')
                    this.warnStep(this.console, 'Upgrading to the Scrypted Desktop application is recommened for Windows and macOS.');
                return;
            }

            if (e !== 'docker' && e !== 'lxc' && e !== 'ha' && e !== 'lxc-docker')
                throw new Error('Unrecognized Linux installation. Installation via Docker image or the official Proxmox LXC script (not tteck) is recommended: https://docs.scrypted.app/installation');
        });

        await this.validate(this.console, 'IPv4 (jsonip.com)', httpFetch({
            url: 'https://jsonip.com',
            family: 4,
            responseType: 'json',
            timeout: 5000,
        }).then(r => r.body.ip));

        await this.validate(this.console, 'IPv6 (jsonip.com)', httpFetch({
            url: 'https://jsonip.com',
            family: 6,
            responseType: 'json',
            timeout: 5000,
        }).then(r => r.body.ip));

        await this.validate(this.console, 'IPv4 (wtfismyip.com)', httpFetch({
            url: 'https://wtfismyip.com/text',
            family: 4,
            responseType: 'text',
            timeout: 5000,
        }).then(r => r.body.trim()));

        await this.validate(this.console, 'IPv6 (wtfismyip.com)', httpFetch({
            url: 'https://wtfismyip.com/text',
            family: 6,
            responseType: 'text',
            timeout: 5000,
        }).then(r => r.body.trim()));

        await this.validate(this.console, 'Scrypted Server Address', async () => {
            const addresses = await sdk.endpointManager.getLocalAddresses();
            const hasIPv4 = addresses?.find(address => net.isIPv4(address));
            const hasIPv6 = addresses?.find(address => net.isIPv6(address));
            if (addresses?.length)
                this.warnStep(this.console, addresses.join(', '));
            if (!hasIPv4)
                throw new Error('Scrypted Settings IPv4 address not set.');
            if (!hasIPv6)
                throw new Error('Scrypted Settings IPv6 address not set.');
        });

        await this.validate(this.console, 'CPU Count', async () => {
            if (os.cpus().length < 2)
                throw new Error('CPU Count is too low. 4 CPUs are recommended.');
            return os.cpus().length;
        });

        await this.validate(this.console, 'Memory', async () => {
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
            // ensure /dev/dri/renderD128 or /dev/dri/renderD129 is available
            await this.validate(this.console, 'GPU Passthrough', async () => {
                if (!fs.existsSync('/dev/dri/renderD128') && !fs.existsSync('/dev/dri/renderD129'))
                    throw new Error('GPU device unvailable or not passed through to container. (/dev/dri/renderD128, /dev/dri/renderD129)');
                // also check /dev/kfd for AMD CPU
                const amdCPU = os.cpus().find(c => c.model.includes('AMD'));
                if (amdCPU && !fs.existsSync('/dev/kfd'))
                    throw new Error('GPU device unvailable or not passed through to container. (/dev/kfd)');
            });
        }

        await this.validate(this.console, 'Cloud Plugin', async () => {
            if (!cloudPlugin) {
                this.warnStep(this.console, 'Cloud plugin not installed. Consider installing for remote access.');
                return;
            }

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

            const shortUrl: any = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.Url + ";short-lived=true");
            const shortLogoCheck = await httpFetch({
                url: shortUrl.toString(),
                responseType: 'buffer',
            });

            if (Buffer.compare(logo.body, shortLogoCheck.body))
                throw new Error('Invalid response received from short lived URL.');
        });

        if ((hasCUDA || process.platform === 'win32') && onnxPlugin) {
            await this.validate(this.console, 'ONNX Plugin', async () => {
                const settings = await onnxPlugin.getSettings();
                const executionDevice = settings.find(s => s.key === 'execution_device');
                if (executionDevice?.value?.toString().includes('CPU'))
                    this.warnStep(this.console, 'GPU device unvailable or not passed through to container.');

                const zidane = await sdk.mediaManager.createMediaObjectFromUrl('https://docs.scrypted.app/img/scrypted-nvr/troubleshooting/zidane.jpg');
                const detected = await onnxPlugin.detectObjects(zidane);
                const personFound = detected.detections!.find(d => d.className === 'person' && d.score > .9);
                if (!personFound)
                    throw new Error('Person not detected in test image.');
            });
        }

        if (!hasCUDA && openvinoPlugin && (process.platform !== 'win32' || !onnxPlugin)) {
            await this.validate(this.console, 'OpenVINO Plugin', async () => {
                const settings = await openvinoPlugin.getSettings();
                const availbleDevices = settings.find(s => s.key === 'available_devices');
                if (!availbleDevices?.value?.toString().includes('GPU'))
                    this.warnStep(this.console, 'GPU device unvailable or not passed through to container.');

                const zidane = await sdk.mediaManager.createMediaObjectFromUrl('https://docs.scrypted.app/img/scrypted-nvr/troubleshooting/zidane.jpg');
                const detected = await openvinoPlugin.detectObjects(zidane);
                const personFound = detected.detections!.find(d => d.className === 'person' && d.score > .9);
                if (!personFound)
                    throw new Error('Person not detected in test image.');
            });
        }

        if (nvrPlugin) {
            await this.validate(this.console, "GPU Decode", async () => {
                const ffmpegPath = await sdk.mediaManager.getFFmpegPath();
                let hasVaapi = false;
                {
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
                        hasVaapi ||= str.includes('Using auto hwaccel type vaapi');

                        if (str.includes('nv12'))
                            deferred.resolve();
                    });

                    setTimeout(() => {
                        deferred.reject(new Error('GPU Decode timed out.'));
                    }, 5000);

                    await deferred.promise;
                }

                if (!hasVaapi || !openvinoPlugin)
                    return;

                {
                    const args = [
                        '-y',
                        '-init_hw_device', 'vaapi=renderD128:/dev/dri/renderD128',
                        '-hwaccel', 'vaapi',
                        '-hwaccel_output_format', 'vaapi',
                        '-i', 'https://docs.scrypted.app/img/scrypted-nvr/troubleshooting/zidane.jpg',
                        '-vf', 'format=nv12,hwupload,scale_vaapi=w=320:h=-2,hwdownload,format=nv12',
                        '-f', 'mjpeg',
                        '-frames:v', '1',
                        'pipe:3',
                    ];

                    const cp = child_process.spawn(ffmpegPath, args, {
                        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
                    });
                    let std = '';
                    cp.stderr!.on('data', data => {
                        std += data.toString();
                    });

                    cp.stdout!.on('data', data => {
                        std += data.toString();
                    });

                    const buffers: Buffer[] = [];
                    cp.stdio[3]?.on('data', buffer => {
                        buffers.push(buffer);
                    });

                    setTimeout(() => {
                        safeKillFFmpeg(cp)
                    }, 5000);

                    const [exitCode] = await once(cp, 'exit');
                    if (exitCode) {
                        this.warnStep(this.console, std);
                        throw new Error('GPU Transform failed.');
                    }

                    const jpeg = Buffer.concat(buffers);
                    const zidane = await sdk.mediaManager.createMediaObject(jpeg, 'image/jpeg');
                    const image = await sdk.mediaManager.convertMediaObject<Image>(zidane, ScryptedMimeTypes.Image);
                    if (image.width !== 320)
                        throw new Error('Unexpected image with from GPU transform.')
                    const detected = await openvinoPlugin.detectObjects(zidane);
                    const personFound = detected.detections!.find(d => d.className === 'person' && d.score > .9);
                    if (!personFound)
                        throw new Error('Person not detected in test image.');
                }

            });


            await this.validate(this.console, 'Deprecated Plugins', async () => {
                const defunctPlugins = [
                    '@scrypted/electron-core',
                    '@scrypted/opencv',
                    '@scrypted/python-codecs',
                    '@scrypted/pam-diff',
                ];
                let found = false;

                for (const plugin of defunctPlugins) {
                    const pluginDevice = sdk.systemManager.getDeviceById(plugin);
                    if (pluginDevice) {
                        this.warnStep(this.console, `Scrypted NVR users can remove: ${plugin}`);
                        found = true;
                    }
                }

                if (found)
                    throw new Error('Deprecated plugins found.');
            });
        }

        this.console.log(''.padEnd(44, '='));
        this.console.log('System Validation Complete');
        this.console.log(''.padEnd(44, '='));
    }
}

export default DiagnosticsPlugin;
