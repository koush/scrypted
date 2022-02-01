import { EventListener, EventListenerRegister, FFMpegInput, LockState, MediaObject, MediaStreamOptions, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { startParserSession, ParserSession, createParserRebroadcaster, Rebroadcaster, createRebroadcaster } from "../../../common/src/ffmpeg-rebroadcast";
import { createMpegTsParser, StreamParser } from "../../../common/src/stream-parser";
const { systemManager, mediaManager } = sdk;

export interface AggregateDevice extends ScryptedDeviceBase {
    computeInterfaces(): string[];
}

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
aggregators.set(ScryptedInterface.IntrusionSensor, allFalse);
aggregators.set(ScryptedInterface.PowerSensor, allFalse);
aggregators.set(ScryptedInterface.MotionSensor, allFalse);
aggregators.set(ScryptedInterface.AudioSensor, allFalse);
aggregators.set(ScryptedInterface.LuminanceSensor, average);
aggregators.set(ScryptedInterface.UltravioletSensor, average);
aggregators.set(ScryptedInterface.FloodSensor, allFalse);
aggregators.set(ScryptedInterface.Lock,
    values => values.reduce((prev, cur) => cur === LockState.Unlocked ? cur : prev, LockState.Locked));


type AggregateCameraParsers = "mpegts";

function createVideoCamera(devices: VideoCamera[], console: Console): VideoCamera {
    let sessionPromise: Promise<{
        session: ParserSession<"mpegts">;
        rebroadcaster: Rebroadcaster;
        parsers: { mpegts: StreamParser };
    }>;

    async function getVideoStreamWrapped(options: MediaStreamOptions) {
        if (sessionPromise) {
            console.error('session already active?');
        }

        const args = await Promise.allSettled(devices.map(async (device) => {
            const mo = await device.getVideoStream();
            const buffer = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.FFmpegInput);
            const ffmpegInput = JSON.parse(buffer.toString()) as FFMpegInput;
            return ffmpegInput;
        }));

        const inputs = args.map(arg => (arg as PromiseFulfilledResult<FFMpegInput>).value).filter(input => !!input);

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

        const filteredInput: FFMpegInput = {
            url: undefined,
            inputArguments: [],
        };

        for (let i = 0; i < inputs.length; i++) {
            filteredInput.inputArguments.push(...inputs[i].inputArguments);
            filter.push(`[${i}:v] setpts=PTS-STARTPTS, scale=${w}x${h} [pos${i}];`)
        }
        for (let i = inputs.length; i < dim * dim; i++) {
            filteredInput.inputArguments.push(
                '-f', 'lavfi', '-i', `color=black:s=${w}x${h}`,
            );
            filter.push(`[${i}:v] setpts=PTS-STARTPTS, scale=${w}x${h} [pos${i}];`)
        }

        filteredInput.inputArguments.push(
            '-f', 'lavfi', '-i', 'anullsrc',
        )

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

        filteredInput.inputArguments.push(
            '-filter_complex',
            filter.join(' '),
        );

        const parsers ={
            mpegts: createMpegTsParser({
                vcodec: ['-vcodec', 'libx264'],
            })
        };
        const ret = await startParserSession(filteredInput, {
            console,
            parsers,
            timeout: 30000,
        });
        
        let rebroadcaster = await createParserRebroadcaster(ret, 'mpegts',{
            idle: {
                timeout: 30000,
                callback: () => ret.kill(),
            }
        })

        return {
            session: ret,
            rebroadcaster,
            parsers,
        };
    };

    return {
        async getVideoStreamOptions() {
            if (devices.length === 1)
                return devices[0].getVideoStreamOptions();
            return [{
                id: 'default',
                name: 'Default',
                video: {},
                audio: null,
            }]
        },

        async getVideoStream(options) {
            if (devices.length === 1)
                return devices[0].getVideoStream(options);

            if (!sessionPromise) {
                sessionPromise = getVideoStreamWrapped(options);
                const ret = await sessionPromise;
                ret.session.on('killed', () => sessionPromise = undefined);
            }

            const ret = await sessionPromise;
            const {url} = ret.rebroadcaster;
            const ffmpegInput: FFMpegInput = {
                url,
                container: 'mpegts',
                inputArguments: [
                  ...(ret.parsers.mpegts.inputArguments || []),
                  '-f', ret.parsers.mpegts.container,
                  '-i', url,
                ],
              }
              
            return mediaManager.createFFmpegMediaObject(ffmpegInput);
        }
    }
}

export function createAggregateDevice(nativeId: string): AggregateDevice {
    class AggregateDeviceImpl extends ScryptedDeviceBase {
        listeners: EventListenerRegister[] = [];

        constructor() {
            super(nativeId);
        }

        makeListener(iface: string, devices: ScryptedDevice[]) {
            const aggregator = aggregators.get(iface);
            if (!aggregator)
                return;

            const property = ScryptedInterfaceDescriptors[iface].properties[0];
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

        computeInterfaces(): string[] {
            this.listeners.forEach(listener => listener.removeListener());
            this.listeners = [];

            try {
                const data = JSON.parse(this.storage.getItem('data'));

                const interfaces = new Map<string, string[]>();
                for (const deviceInterface of data.deviceInterfaces) {
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

                    if (iface === ScryptedInterface.VideoCamera) {
                        const camera = createVideoCamera(devices as any, this.console);
                        for (const method of descriptor.methods) {
                            AggregateDeviceImpl.prototype[method] = (...args: any[]) => camera[method](...args);
                        }
                        continue;
                    }

                    for (const method of descriptor.methods) {
                        AggregateDeviceImpl.prototype[method] = async function (...args: any[]) {
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
                this.console.error('error loading aggregate device', e);
                return [];
            }
        }
    }

    const ret = new AggregateDeviceImpl();
    ret.computeInterfaces();
    return new AggregateDeviceImpl();
}