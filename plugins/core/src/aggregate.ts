import sdk, { EventListener, EventListenerRegister, FFmpegInput, LockState, MediaStreamDestination, RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import type { AggregateCore } from "./aggregate-core";
const { systemManager, mediaManager, deviceManager } = sdk;

interface Aggregator<T> {
    (values: T[]): T;
}

const aggregators = new Map<string, Aggregator<any>>();

const average: Aggregator<number> = values => values.reduce((prev, cur) => prev + (cur || 0), 0) / (values.length || 0);
const allFalse: Aggregator<boolean> = values => values.reduce((prev, cur) => prev || cur, false);
const allTrue: Aggregator<boolean> = values => values.reduce((prev, cur) => prev && cur, true);

aggregators.set(ScryptedInterface.Online, allTrue);
aggregators.set(ScryptedInterface.StartStop, allTrue);
aggregators.set(ScryptedInterface.Pause, allFalse);
aggregators.set(ScryptedInterface.OnOff, allFalse);
aggregators.set(ScryptedInterface.Brightness, average);
aggregators.set(ScryptedInterface.Battery, average);
aggregators.set(ScryptedInterface.MotionSensor, average);
aggregators.set(ScryptedInterface.HumiditySensor, average);
aggregators.set(ScryptedInterface.Thermometer, average);
aggregators.set(ScryptedInterface.BinarySensor, allFalse);
aggregators.set(ScryptedInterface.TamperSensor, allFalse);
aggregators.set(ScryptedInterface.PowerSensor, allFalse);
aggregators.set(ScryptedInterface.MotionSensor, allFalse);
aggregators.set(ScryptedInterface.AudioSensor, allFalse);
aggregators.set(ScryptedInterface.LuminanceSensor, average);
aggregators.set(ScryptedInterface.UltravioletSensor, average);
aggregators.set(ScryptedInterface.CO2Sensor, average);
aggregators.set(ScryptedInterface.PM25Sensor, average);
aggregators.set(ScryptedInterface.PM10Sensor, average);
aggregators.set(ScryptedInterface.NOXSensor, average);
aggregators.set(ScryptedInterface.FloodSensor, allFalse);
aggregators.set(ScryptedInterface.Lock,
    values => values.reduce((prev, cur) => cur === LockState.Unlocked ? cur : prev, LockState.Locked));


function createVideoCamera(devices: VideoCamera[], console: Console): VideoCamera {
    async function getVideoStreamWrapped(options: RequestMediaStreamOptions) {
        const destination: MediaStreamDestination = devices.length > 4 ? 'low-resolution' : "medium-resolution";
        const args = await Promise.allSettled(devices.map(async (device) => {
            const mo = await device.getVideoStream({
                destination,
            });
            const buffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
            const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;
            return ffmpegInput;
        }));

        const inputs = args.map(arg => (arg as PromiseFulfilledResult<FFmpegInput>).value).filter(input => !!input);

        if (!inputs.length)
            throw new Error('no inputs');

        let dim = 1;
        while (dim * dim < inputs.length) {
            dim++;
        }

        const w = 1920 / dim;
        const h = 1080 / dim;

        const filter = [
            'nullsrc=size=1920x1080 [base];'
        ];

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            container: 'rawvideo',
            mediaStreamOptions: (await createVideoStreamOptions())?.[0],
            inputArguments: [],
        };

        for (let i = 0; i < inputs.length; i++) {
            ffmpegInput.inputArguments.push(...inputs[i].inputArguments);
            // https://superuser.com/a/891478
            filter.push(`[${i}:v] scale=(iw*sar)*min(${w}/(iw*sar)\\,${h}/ih):ih*min(${w}/(iw*sar)\\,${h}/ih),pad=${w}:${h}:(${w}-iw*min(${w}/iw\\,${h}/ih))/2:(${h}-ih*min(${w}/iw\\,${h}/ih))/2 [pos${i}];`)
        }
        for (let i = inputs.length; i < dim * dim; i++) {
            ffmpegInput.inputArguments.push(
                '-f', 'lavfi', '-i', `color=black:s=${w}x${h}`,
            );
            filter.push(`[${i}:v] scale=${w}x${h} [pos${i}];`)
        }

        let prev = 'base';
        let curx = 0;
        let cury = 0;
        for (let i = 0; i < dim * dim - 1; i++) {
            let cur = `tmp${i}`;
            cury = Math.floor(i / dim) * h;
            filter.push(`[${prev}][pos${i}] overlay=shortest=1:x=${curx % 1920}:y=${cury % 1080} [${cur}];`);
            prev = cur;
            curx += w;
        }


        let i = dim * dim - 1;
        filter.push(`[${prev}][pos${i}] overlay=shortest=1:x=${curx % 1920}:y=${cury % 1080}`);

        ffmpegInput.inputArguments.push(
            '-filter_complex',
            filter.join(' '),
        );

        return ffmpegInput;
    };

    const createVideoStreamOptions: () => Promise<ResponseMediaStreamOptions[]> = async () => {
        if (devices.length === 1)
            return devices[0].getVideoStreamOptions();
        return [{
            id: 'default',
            name: 'Default',
            container: 'ffmpeg',
            video: {},
            audio: null,
        }]
    }

    return {
        async getVideoStreamOptions() {
            return createVideoStreamOptions();
        },

        async getVideoStream(options) {
            if (devices.length === 1)
                return devices[0].getVideoStream(options);

            const ffmpegInput = await getVideoStreamWrapped(options);

            return mediaManager.createFFmpegMediaObject(ffmpegInput);
        }
    }
}

export class AggregateDevice extends ScryptedDeviceBase implements Settings {
    listeners: EventListenerRegister[] = [];
    storageSettings = new StorageSettings(this, {
        deviceInterfaces: {
            title: 'Selected Device Interfaces',
            description: 'The components of other devices to combine into this device group.',
            type: 'interface',
            multiple: true,
            deviceFilter: `id !== '${this.id}' && deviceInterface !== '${ScryptedInterface.Settings}'`,
            onPut: () => {
                this.core.reportAggregate(this.nativeId, this.computeInterfaces(), this.providedName);
            }
        }
    })

    constructor(public core: AggregateCore, nativeId: string) {
        super(nativeId);

        try {
            const data = this.storage.getItem('data');
            if (data) {
                const { deviceInterfaces } = JSON.parse(data);
                this.storageSettings.values.deviceInterfaces = deviceInterfaces;
            }
        }
        catch (e) {
        }
       this.storage.removeItem('data');
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    makeListener(iface: string, devices: ScryptedDevice[]) {
        const aggregator = aggregators.get(iface);
        if (!aggregator) {
            const ds = deviceManager.getDeviceState(this.nativeId);
            // if this device can't be aggregated for whatever reason, pass property through.
            for (const device of devices) {
                const register = device.listen({
                    event: iface,
                    watch: true,
                }, (source, details, data) => {
                    if (details.property)
                        ds[details.property] = data;
                });
                this.listeners.push(register);
            }
            return;
        }

        const property = ScryptedInterfaceDescriptors[iface]?.properties?.[0];
        if (!property) {
            this.console.warn('aggregating interface with no property?', iface);
            return;
        }

        const runAggregator = () => {
            const values = devices.map(device => device[property]);
            (this as any)[property] = aggregator(values);
        }

        const listener: EventListener = () => runAggregator();

        for (const device of devices) {
            const register = device.listen({
                event: iface,
                watch: true,
            }, listener);
            this.listeners.push(register);
        }

        return runAggregator;
    }

    release() {
        this.listeners.forEach(listener => listener.removeListener());
        this.listeners = [];
    }

    computeInterfaces(): string[] {
        this.release();

        try {
            const interfaces = new Map<string, string[]>();
            for (const deviceInterface of this.storageSettings.values.deviceInterfaces as string[]) {
                const parts = deviceInterface.split('#');
                const id = parts[0];
                const iface = parts[1];
                if (!interfaces.has(iface))
                    interfaces.set(iface, []);
                interfaces.get(iface).push(id);
            }

            for (const [iface, ids] of interfaces.entries()) {
                const devices = ids.map(id => systemManager.getDeviceById(id));
                const runAggregator = this.makeListener(iface, devices);
                runAggregator?.();
            }

            for (const [iface, ids] of interfaces.entries()) {
                const devices = ids.map(id => systemManager.getDeviceById(id));
                const descriptor = ScryptedInterfaceDescriptors[iface];
                if (!descriptor) {
                    this.console.warn(`descriptor not found for ${iface}, skipping method generation`);
                    continue;
                }

                if (iface === ScryptedInterface.VideoCamera) {
                    const camera = createVideoCamera(devices as any, this.console);
                    for (const method of descriptor.methods) {
                        this[method] = (...args: any[]) => camera[method](...args);
                    }
                    continue;
                }

                for (const method of descriptor.methods) {
                    this[method] = async function (...args: any[]) {
                        const ret: Promise<any>[] = [];
                        for (const device of devices) {
                            ret.push(device[method](...args));
                        }

                        const results = await Promise.all(ret);
                        return results[0];
                    }
                }
            }

            return [...interfaces.keys()];
        }
        catch (e) {
            // this.console.error('error loading aggregate device', e);
            return [];
        }
    }
}
