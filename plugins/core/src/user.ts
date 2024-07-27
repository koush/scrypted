import sdk, { DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedUser, ScryptedUserAccessControl, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { addAccessControlsForInterface } from "@scrypted/sdk/acl";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
export const UsersNativeId = 'users';

type DBUser = { username: string, admin: boolean };

export class User extends ScryptedDeviceBase implements Settings, ScryptedUser {
    storageSettings = new StorageSettings(this, {
        defaultAccess: {
            title: 'Default Access',
            description: 'Grant access to @scrypted/core and @scrypted/webrtc',
            defaultValue: true,
            type: 'boolean',
        },
        admin: {
            title: 'Administrator',
            mapGet: () => '<div style="font-size: .8rem; margin-bottom: 16px; margin-left: 8px;">This user has administrator access.</div>',
            type: 'html',
            hide: true,
        },
        interfaces: {
            title: 'Interfaces',
            description: 'The interfaces this user can access. Admin users can access all interfaces on all devices. Scrypted NVR users should use NVR Permissions to grant access to the NVR and associated cameras.',
            type: 'interface',
            multiple: true,
            defaultValue: [],
        },
    });

    _admin: boolean;
    async getAdmin() {
        if (this._admin !== undefined)
            return this._admin;
        const usersService = await sdk.systemManager.getComponent('users');
        const users: DBUser[] = await usersService.getAllUsers();
        const user = users.find(user => user.username === this.username);
        if (!user)
            throw new Error("user not found");
        this._admin = !!user.admin;
        if (this._admin) {
            this.storageSettings.settings.defaultAccess.hide = true;
            this.storageSettings.settings.interfaces.hide = true;
            this.storageSettings.settings.admin.hide = false;
        }
        return this._admin;
    }

    async getScryptedUserAccessControl(): Promise<ScryptedUserAccessControl> {
        if (await this.getAdmin())
            return;

        const self = sdk.deviceManager.getDeviceState(this.nativeId);

        const ret: ScryptedUserAccessControl = {
            devicesAccessControls: [
                ...this.storageSettings.values.defaultAccess
                    ? [
                        // grant this? not sure.
                        addAccessControlsForInterface(self.id, ScryptedInterface.ScryptedDevice),
                        addAccessControlsForInterface(sdk.systemManager.getDeviceByName('@scrypted/webrtc').id,
                            ScryptedInterface.ScryptedDevice,
                            ScryptedInterface.EngineIOHandler),
                        addAccessControlsForInterface(sdk.systemManager.getDeviceByName('@scrypted/core').id,
                            ScryptedInterface.ScryptedDevice,
                            ScryptedInterface.EngineIOHandler),
                    ]
                    : [],
                ...this.storageSettings.values.interfaces.map((deviceInterface: string) => {
                    const [id, scryptedInterface] = deviceInterface.split('#');
                    return addAccessControlsForInterface(id, ScryptedInterface.ScryptedDevice, scryptedInterface as ScryptedInterface);
                }),
            ]
        };

        return ret;
    }

    get username() {
        return this.nativeId.substring('user:'.length);
    }

    async getSettings(): Promise<Setting[]> {
        await this.getAdmin();

        return [
            {
                key: 'username',
                title: 'User Name',
                readonly: true,
                value: this.username,
            },
            {
                key: 'password',
                title: 'Password',
                description: 'Change the password.',
                type: 'password',
            },
            ...await this.storageSettings.getSettings(),
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key !== 'password')
            return this.storageSettings.putSetting(key, value);
        const usersService = await sdk.systemManager.getComponent('users');
        const users: DBUser[] = await usersService.getAllUsers();
        const user = users.find(user => user.username === this.username);
        if (!user)
            return;
        const { username, admin } = user;
        const nativeId = `user:${username}`;
        const aclId = await sdk.deviceManager.onDeviceDiscovered({
            providerNativeId: this.nativeId,
            name: username.toString(),
            nativeId,
            interfaces: [
                ScryptedInterface.ScryptedUser,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Person,
        })
        await usersService.addUser(user.username, value.toString(), admin ? undefined : aclId);
    }
}

export class UsersCore extends ScryptedDeviceBase implements Readme, DeviceProvider, DeviceCreator {
    constructor() {
        super(UsersNativeId);

        this.systemDevice = {
            deviceCreator: 'Scrypted User',
        };

        this.syncUsers();
    }

    async getDevice(nativeId: string): Promise<any> {
        return new User(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        const username = nativeId.substring('user:'.length);
        const usersService = await sdk.systemManager.getComponent('users');
        await usersService.removeUser(username);
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'User name',
            },
            {
                key: 'password',
                type: 'password',
                title: 'Password',
            },
            {
                key: 'admin',
                type: 'boolean',
                title: 'Admin',
                description: 'Grant this user administrator privileges.',
            },
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const { username, password, admin } = settings;
        const usersService = await sdk.systemManager.getComponent('users');
        const nativeId = `user:${username}`;
        const aclId = await sdk.deviceManager.onDeviceDiscovered({
            providerNativeId: this.nativeId,
            name: username.toString(),
            nativeId,
            interfaces: [
                ScryptedInterface.ScryptedUser,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Person,
        })

        await usersService.addUser(username, password, admin ? undefined : aclId);
        await this.syncUsers();
        return nativeId;
    }

    async getReadmeMarkdown(): Promise<string> {
        return "Create and Manage the users that can log into Scrypted.";
    }

    async syncUsers() {
        const usersService = await sdk.systemManager.getComponent('users');
        const users: DBUser[] = await usersService.getAllUsers();
        await sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices: users.map(user => ({
                name: user.username,
                nativeId: `user:${user.username}`,
                interfaces: [
                    ScryptedInterface.ScryptedUser,
                    ScryptedInterface.Settings,
                ],
                type: ScryptedDeviceType.Person,
            })),
        })
    }
}
