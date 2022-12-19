import sdk, { DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedUser, ScryptedUserAccessControl, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { addAccessControlsForInterface } from "@scrypted/sdk/acl";
export const UsersNativeId = 'users';

type DBUser = { username: string, aclId: string };

export class User extends ScryptedDeviceBase implements Settings, ScryptedUser {
    async getScryptedUserAccessControl(): Promise<ScryptedUserAccessControl> {
        return {
            devicesAccessControls: [
                addAccessControlsForInterface(sdk.systemManager.getDeviceByName('@scrypted/core').id,
                    ScryptedInterface.ScryptedDevice,
                    ScryptedInterface.EngineIOHandler),
            ]
        };
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            }
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key !== 'password')
            return;
        const usersService = await sdk.systemManager.getComponent('users');
        const users: DBUser[] = await usersService.getAllUsers();
        const user = users.find(user => user.username === this.nativeId.substring('user:'.length));
        if (!user)
            return;
        await usersService.addUser(user.username, value.toString(), user.aclId);
    }
}

export class UsersCore extends ScryptedDeviceBase implements Readme, DeviceProvider, DeviceCreator {
    constructor() {
        super(UsersNativeId);

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
                key: 'admin',
                type: 'boolean',
                title: 'Admin',
                description: 'Grant this user administrator privileges.',
            },
            {
                key: 'password',
                type: 'password',
                title: 'Password',
            }
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
            type: ScryptedDeviceType.Builtin,
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
                type: ScryptedDeviceType.Builtin,
            })),
        })
    }
}
