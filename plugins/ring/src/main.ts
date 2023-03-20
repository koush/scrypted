import sdk, { Device, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { RingLocationDevice } from './location';
import { generateUuid, Location, RingBaseApi, RingRestClient } from './ring-client-api';

const { deviceManager, mediaManager } = sdk;

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
    loginClient: RingRestClient;
    api: RingBaseApi;
    devices = new Map<string, RingLocationDevice>();
    locations: Location[];

    settingsStorage = new StorageSettings(this, {
        systemId: {
            title: 'System ID',
            description: 'Used to provide client uniqueness for retrieving the latest set of events.',
            hide: true,
        },
        email: {
            title: 'Email',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        loginCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your Ring account, enter the code sent by Ring to your email or phone number.',
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                this.console.log('login completed successfully with 2 factor code');
                await this.discoverDevices();
                this.console.log('discovery completed successfully');
            },
            noStore: true,
        },
        refreshToken: {
            hide: true,
        },
        locationIds: {
            title: 'Location ID',
            description: 'Optional: If supplied will on show this locationID.',
            hide: true,
        },
        cameraDingsPollingSeconds: {
            title: 'Poll Interval',
            type: 'number',
            description: 'Optional: Change the default polling interval for motion and doorbell events.',
            defaultValue: 5,
        },
        nightModeBypassAlarmState: {
            title: 'Night Mode Bypass Alarm State',
            description: 'Set this to enable the "Night" option on the alarm panel. When arming in "Night" mode, all open sensors will be bypassed and the alarm will be armed to the selected option.',
            choices: [
                'Disabled',
                'Home',
                'Away'
            ],
            defaultValue: 'Disabled',
        },
    });

    constructor() {
        super();
        this.discoverDevices()
            .catch(e => this.console.error('discovery failure', e));

        if (!this.settingsStorage.values.systemId)
            this.settingsStorage.values.systemId = generateUuid();
    }

    async clearTryDiscoverDevices() {
        this.settingsStorage.values.refreshToken = undefined;
        await this.discoverDevices();
        this.console.log('discovery completed successfully');
    }

    async tryLogin(code?: string) {
        const locationIds = this.settingsStorage.values.locationIds ? [this.settingsStorage.values.locationIds] : undefined;
        const cameraStatusPollingSeconds = 20;

        const createRingApi = async () => {
            this.api = new RingBaseApi({
                refreshToken: this.settingsStorage.values.refreshToken,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                locationIds,
                cameraStatusPollingSeconds,
                cameraDingsPollingSeconds: this.settingsStorage.values.cameraDingsPollingSeconds,
                systemId: this.settingsStorage.values.systemId,
            }, {
                createPeerConnection: () => {
                    throw new Error('unreachable');
                },
            });

            this.api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
                this.settingsStorage.values.refreshToken = newRefreshToken;
            });
        }

        if (this.settingsStorage.values.refreshToken) {
            await createRingApi();
            return;
        }

        if (!this.settingsStorage.values.email || !this.settingsStorage.values.password) {
            this.log.a('Enter your Ring username and password to complete setup.');
            throw new Error('refresh token, username, and password are missing.');
        }

        if (!code) {
            this.loginClient = new RingRestClient({
                email: this.settingsStorage.values.email,
                password: this.settingsStorage.values.password,
            });
            try {
                const auth = await this.loginClient.getCurrentAuth();
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                if (this.loginClient.promptFor2fa) {
                    this.log.a('Check your email or texts for your Ring login code, then enter it into the Two Factor Code setting to conplete login.');
                    return;
                }
                this.console.error(e);
                this.log.a('Login failed.');
                throw e;
            }
        }
        else {
            try {
                const auth = await this.loginClient.getAuth(code);
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                this.console.error(e);
                this.log.a('Login failed.');
                throw e;
            }
        }
        await createRingApi();
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices() {
        await this.tryLogin();
        this.console.log('login success, trying discovery');
        this.locations = await this.api.getLocations();

        const locationDevices: Device[] = this.locations.map(location => {
            const interfaces = [
                ScryptedInterface.DeviceProvider,
            ];
            let type = ScryptedDeviceType.DeviceProvider;
            if (location.hasAlarmBaseStation) {
                interfaces.push(ScryptedInterface.SecuritySystem);
                type = ScryptedDeviceType.SecuritySystem;
            }
            return {
                nativeId: location.id,
                name: location.name,
                type,
                interfaces,
            };
        });

        await deviceManager.onDevicesChanged({
            devices: locationDevices,
        });

        // probe to intiailize locations
        for (const device of locationDevices) {
            await this.getDevice(device.nativeId);
        };
    }

    async getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const location = this.locations.find(x => x.id === nativeId);
            const device = new RingLocationDevice(this, nativeId, location);
            this.devices.set(nativeId, device);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {}
}

export default RingPlugin;
