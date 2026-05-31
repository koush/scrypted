import sdk, { MixinProvider, PanTiltZoom, PanTiltZoomCommand, PanTiltZoomMovement, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '../../../common/src/settings-mixin';
import { connectCameraAPI } from "./onvif-api";

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
                    ...this.ptzCapabilities,
                    pan: ptz.includes('Pan'),
                    tilt: ptz.includes('Tilt'),
                    zoom: ptz.includes('Zoom'),
                }
            }
        },
        ptzMovementType: {
            title: 'PTZ Movement Type',
            description: 'The type of movement to use for PTZ commands by default.',
            type: 'string',
            choices: [
                'Default',
                PanTiltZoomMovement.Absolute,
                PanTiltZoomMovement.Relative,
                PanTiltZoomMovement.Continuous,
            ],
            defaultValue: 'Default',
        },
        presets: {
            title: 'Presets',
            description: 'PTZ Presets in the format "key=name". Where key is the PTZ Preset identifier and name is a friendly name.',
            multiple: true,
            defaultValue: [],
            combobox: true,
            onPut: async (ov, presets: string[]) => {
                const caps = {
                    ...this.ptzCapabilities,
                    presets: {},
                };
                for (const preset of presets) {
                    const [key, name] = preset.split('=');
                    caps.presets[key] = name;
                }
                this.ptzCapabilities = caps;
            },
            mapGet: () => {
                const presets = this.ptzCapabilities?.presets || {};
                return Object.entries(presets).map(([key, name]) => key + '=' + name);
            },
        },
        cachedPresets: {
            multiple: true,
            hide: true,
            json: true,
            defaultValue: {},
        },
    });

    constructor(options: SettingsMixinDeviceOptions<Settings>) {
        super(options);

        // force a read to set the state.
        this.storageSettings.values.ptz;

        this.refreshPresets();

        this.storageSettings.settings.presets.onGet = async () => {
            // getPresets is where the key is the name of the preset, and the value is the id.
            // kind of weird and backwards.
            const choices = Object.entries(this.storageSettings.values.cachedPresets).map(([name, key]) => key + '=' + name);
            return {
                choices,
            };
        };
    }

    async refreshPresets() {
        const client = await this.getClient();
        client.cam.getPresets({}, (e, result, xml) => {
            if (e) {
                this.console.error('failed to get presets', e);
            }
            else {
                this.console.log('presets', result);
                this.storageSettings.values.cachedPresets = result;
            }
        });
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async ptzCommand(command: PanTiltZoomCommand) {
        const client = await this.getClient();
        let speed: any;

        if (command.speed) {
            speed = {
                x: command.speed.pan,
                y: command.speed.tilt,
                zoom: command.speed.zoom
            };
        }

        let movement = command.movement || this.storageSettings.values.ptzMovementType;
        if (movement === PanTiltZoomMovement.Absolute) {
            return new Promise<void>((r, f) => {
                client.cam.absoluteMove({
                    x: command.pan,
                    y: command.tilt,
                    zoom: command.zoom,
                    speed: speed,
                }, (e, result, xml) => {
                    if (e)
                        return f(e);
                    r();
                });
            })
        }
        else if (movement === PanTiltZoomMovement.Continuous) {
            let x = command.pan;
            let y = command.tilt;
            let zoom = command.zoom;
            if (command.speed?.pan)
                x *= command.speed.pan;
            if (command.speed?.tilt)
                y *= command.speed.tilt;
            if (command.speed?.zoom)
                zoom *= command.speed.zoom;
            return new Promise<void>((r, f) => {
                client.cam.continuousMove({
                    x: command.pan,
                    y: command.tilt,
                    zoom: command.zoom,
                    timeout: command.timeout || 1000,
                }, (e, result, xml) => {
                    if (e)
                        return f(e);
                    r();
                })
            });
        }
        else if (movement === PanTiltZoomMovement.Home) {
            return new Promise<void>((r, f) => {
                client.cam.gotoHomePosition({
                    speed: speed,
                }, (e, result, xml) => {
                    if (e)
                        return f(e);
                    r();
                })
            });
        }
        else if (movement === PanTiltZoomMovement.Preset) {
            return new Promise<void>((r, f) => {
                client.cam.gotoPreset({
                    preset: command.preset,
                }, (e, result, xml) => {
                    if (e)
                        return f(e);
                    r();
                })
            });
        }
        else {
            // relative movement is default.
            return new Promise<void>((r, f) => {
                client.cam.relativeMove({
                    x: command.pan,
                    y: command.tilt,
                    zoom: command.zoom,
                    speed: speed
                }, (e, result, xml) => {
                    if (e)
                        return f(e);
                    r();
                })
            });
        }
    }

    async getClient() {
        const creds = await this.getCredentials();
        return connectCameraAPI(creds.ipAndPort, creds.username, creds.password, this.console, undefined)
    }

    async getCredentials() {
        const realDevice = sdk.systemManager.getDeviceById<Settings>(this.id);
        const settings = await realDevice.getSettings();
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

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
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
