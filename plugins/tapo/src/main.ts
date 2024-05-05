import { SettingsMixinDeviceBase } from '@scrypted/common/src/settings-mixin';
import sdk, { DeviceProvider, FFmpegInput, Intercom, MediaObject, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { MpegTSWriter, StreamTypePCMATapo } from './mpegts-writer';
import { TapoAPI } from './tapo-api';

class TapoIntercomMixin extends SettingsMixinDeviceBase<VideoCamera & Settings> implements Intercom {
    storageSettings = new StorageSettings(this, {
        cloudPassword: {
            title: 'Cloud Password',
            description: 'The Tapo Cloud account password. This is not the same as the ONVIF/RTSP local password.',
            type: 'password',
        }
    });
    client: Promise<TapoAPI>;

    async startIntercom(media: MediaObject): Promise<void> {
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

        const settings = await this.mixinDevice.getSettings();
        const ip = settings.find(s => s.key === 'ip')?.value?.toString();
        await this.stopIntercom();

        if (!this.storageSettings.values.cloudPassword) {
            const error = 'Two Way Audio failed. Tapo Cloud password is unconfigured on ' + this.name;
            sdk.log.a(error);
            throw error;
        }

        this.client = TapoAPI.connect({
            address: `${ip}:8800`,
            cloudPassword: this.storageSettings.values.cloudPassword,
        });

        const client = await this.client;
        client.processMessages();
        const mpegts = await client.startMpegTsBackchannel();

        const w = new MpegTSWriter();
        w.AddPES(68, StreamTypePCMATapo)
        w.WritePAT()
        w.WritePMT()

        const forwarder = await startRtpForwarderProcess(this.console, ffmpegInput, {
            audio: {
                codecCopy: 'pcm_alaw',
                encoderArguments: [
                    '-vn', '-sn', '-dn',
                    '-acodec', 'pcm_alaw',
                    '-ar', '8000',
                    '-ac', '1',
                ],
                onRtp: rtp => {
                    const payload = rtp.subarray(12);
                    w.WritePES(68, 192, payload)
                    const bytes = w.ResetBytes();
                    mpegts.write(bytes);
                }
            }
        });

        // cp.stdio[3].pipe(mpegts);
        forwarder.killPromise.finally(() => client.stream.destroy());
        client.stream.on('close', () => forwarder.kill());
    }

    async stopIntercom(): Promise<void> {
        const c = this.client;
        this.client = undefined;
        const client = await c;
        client?.stream.destroy();
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
    putMixinSetting(key: string, value: SettingValue): Promise<boolean | void> {
        return this.storageSettings.putSetting(key, value);
    }
}

class TapoIntercom extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type !== ScryptedDeviceType.Doorbell && type !== ScryptedDeviceType.Camera)
            return;
        if (!interfaces.includes(ScryptedInterface.VideoCamera) || !interfaces.includes(ScryptedInterface.Settings)
            // this is currently a necessary hack to make sure the intercom gets advertised
            // before the homekit and webrtc plugins mixin it.
            || !interfaces.includes(ScryptedInterface.Intercom)) {
            return;

        }
        return [
            ScryptedInterface.Intercom,
            ScryptedInterface.Settings,
        ]
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new TapoIntercomMixin({
            mixinProviderNativeId: this.nativeId,
            group: 'Tapo Two Way Audio',
            groupKey: 'tapo',
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
        });
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    }
}

class TapoPlugin extends ScryptedDeviceBase implements DeviceProvider {
    constructor(nativeId?: string) {
        super(nativeId);

        process.nextTick(() => {
            sdk.deviceManager.onDeviceDiscovered({
                nativeId: 'intercom',
                type: ScryptedDeviceType.Builtin,
                interfaces: [
                    ScryptedInterface.MixinProvider,
                ],
                name: 'Tapo Two Way Audio',
            });
        })
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId === 'intercom')
            return new TapoIntercom('intercom');
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

export default TapoPlugin;
