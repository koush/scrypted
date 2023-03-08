import { DeviceState, MixinDeviceBase, MixinDeviceOptions, MixinProvider, PanTiltZoom, PanTiltZoomCommand, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { connectCameraAPI } from "./onvif-api";
import {SettingsMixinDeviceBase, SettingsMixinDeviceOptions} from '../../../common/src/settings-mixin';

export class OnvifPtzMixin extends SettingsMixinDeviceBase<Settings> implements PanTiltZoom, Settings {
    storageSettings = new StorageSettings(this, {
        ptz: {
            title: 'Pan/Tilt/Zoom',
            type: 'string',
            multiple: true,
            choices: [
                'Pan',
                'Tilt',
                'Zoom',
            ],
            persistedDefaultValue: [
                'Pan',
                'Tilt',
            ],
            onPut: (ov, ptz: string[]) => {
                this.ptzCapabilities = {
                    pan: ptz.includes('Pan'),
                    tilt: ptz.includes('Tilt'),
                    zoom: ptz.includes('Zoom'),
                }
            }
        }
    });

    constructor(options: SettingsMixinDeviceOptions<Settings>) {
        super(options);

        // force a read to set the state.
        this.storageSettings.values.ptz;
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async ptzCommand(command: PanTiltZoomCommand) {
        const client = await this.getClient();
        return new Promise<void>((r, f) => {
            client.cam.relativeMove({
                x: command.pan,
                y: command.tilt,
                zoom: command.zoom,
            }, (e, result, xml) => {
                if (e)
                    return f(e);
                r();
            })
        })
    }

    async getClient() {
        const creds = await this.getCredentials();
        return connectCameraAPI(creds.ipAndPort, creds.username, creds.password, this.console, undefined)
    }

    async getCredentials() {
        const settings = await this.mixinDevice.getSettings();
        const username = settings.find(s => s.key === 'username')?.value?.toString();
        const password = settings.find(s => s.key === 'password')?.value?.toString();
        const ip = settings.find(s => s.key === 'ip')?.value?.toString();
        const httpPort = settings.find(s => s.key === 'httpPort')?.value?.toString();
        const ipAndPort = `${ip}:${httpPort || 80}`;

        return {
            ipAndPort,
            username,
            password,
        }
    }
}

export class OnvifPTZMixinProvider extends ScryptedDeviceBase implements MixinProvider {
    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type !== ScryptedDeviceType.Camera || !interfaces.includes(ScryptedInterface.VideoCamera) || !interfaces.includes(ScryptedInterface.Settings))
            return;

        return [
            ScryptedInterface.PanTiltZoom,
            ScryptedInterface.Settings,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState): Promise<any> {
        return new OnvifPtzMixin({
            group: 'ONVIF PTZ',
            groupKey: 'ptz',
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
        })
    }
}
