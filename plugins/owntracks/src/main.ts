// https://developer.scrypted.app/#getting-started
import sdk, { Settings, DeviceProvider, ScryptedDeviceType, OccupancySensor, Setting, HttpRequest, PasswordStore, PushHandler, PositionSensor, ScryptedInterface } from "@scrypted/sdk";
import { ScryptedDeviceBase } from "@scrypted/sdk";
const { log, deviceManager, endpointManager } = sdk;
import auth from 'basic-auth';

class OwntracksUser extends ScryptedDeviceBase implements PositionSensor {
    constructor(nativeId: string) {
        super(nativeId);
    }
}

class OwntracksRegion extends ScryptedDeviceBase implements OccupancySensor, Settings {
    getSetting(key: string): string | number | boolean {
        return null;
    }
    // create settings that correspond to allowed usernames in this region
    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [];
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            ret.push({
                key,
                value: key,
                title: 'Owntracks Username',
                description: 'This sensor will be marked as occupied if this user is in this Owntracks region.',
            })
        }
        ret.push({
            title: 'Add User',
            placeholder: 'username',
            description: 'Owntracks Username',
            key: 'new-user',
        })
        return ret;
    }
    // create/rename users
    async putSetting(key: string, value: string | number | boolean) {
        if (key == 'new-user') {
            this.storage.setItem(value as string, false.toString());
            return;
        }
        this.storage.removeItem(key);
        if ((value as string).length) {
            this.storage.setItem(value as string, false.toString());
        }
        this.sendOccupancyEvent();
    }
    // look at the user status for every user, and send the correct event.
    // todo: timestamp? purge old users?
    sendOccupancyEvent() {
        for (let i = 0; i < this.storage.length; i++) {
            const key = this.storage.key(i);
            if (this.storage.getItem(key) === 'true') {
                this.occupied = true;
                return;
            }
        }
        this.occupied = false;
    }
    constructor(nativeId: string) {
        super(nativeId);
    }
}

class Owntracks extends ScryptedDeviceBase implements PushHandler, Settings, DeviceProvider, PasswordStore {
    constructor() {
        super();
        if (!localStorage.getItem('private_http')) {
            endpointManager.getPublicPushEndpoint().then(endpoint => {
                localStorage.setItem('private_http', endpoint);
                log.a('The Owntracks Private HTTP endpoint is available in Settings.');
            });
        }
    }

    // owntracks will call the endpoint with a password, so set up a simple password store
    // that can be accessed via the scrypted web ui. this allows revocation of passwords,
    // and denial of unauthorized users that may have the owntracks private http endpoint.
    async getPasswords(): Promise<string[]> {
        try {
            return JSON.parse(localStorage.getItem('passwords')) || [];
        }
        catch (e) {
            return [];
        }
    }

    get passwords(): string[] {
        try {
            return JSON.parse(localStorage.getItem('passwords')) || [];
        }
        catch (e) {
            return [];
        }
    }

    savePasswords(passwords: string[]) {
        const uniques = {};
        passwords.map(password => uniques[password] = true);
        passwords = Object.keys(uniques);
        localStorage.setItem('passwords', JSON.stringify(passwords));
    }
    async addPassword(password: string) {
        const passwords = this.passwords;
        passwords.push(password)
        this.savePasswords(passwords);
    }
    async removePassword(password: string) {
        const passwords = this.passwords;
        passwords.filter(entry => entry != password);
        this.savePasswords(passwords);
    }
    async checkPassword(password: string): Promise<boolean> {
        return this.passwords.includes(password);
    }

    async discoverDevices(duration: number) {
    }
    getDevice(nativeId: string) {
        return new OwntracksRegion(nativeId);
    }
    getSetting(key: string): string | number | boolean {
        return null;
    }
    async getSettings(): Promise<Setting[]> {
        // create a settings menu that shows the private http endpoint, and allows creation of new regions.
        return [
            {
                key: 'private_http',
                title: 'Private HTTP',
                description: 'The Private HTTP endpoint that is configured within the Owntracks mobile application. Owntracks users will need to authenticate with one of the passcodes set up by this Plugin.',
                readonly: true,
                value: localStorage.getItem('private_http') || 'Error creating Private HTTP. Try reloading the plugin',
            },
            {
                key: 'region',
                description: 'The name of the Region within Owntracks. Multiple users may specifiy the same Region. The OccupancySensor will be marked as occupied when any of them are within that Region.',
                title: 'Add Owntracks Region',
            },
        ];
    }
    async putSetting(key: string, value: string | number | boolean) {
        // creat the named region from the setting.
        deviceManager.onDeviceDiscovered({
            name: value.toString(),
            interfaces: ['OccupancySensor', 'Settings'],
            nativeId: value.toString(),
            type: ScryptedDeviceType.Sensor,
        });
    }
    getEndpoint(): string {
        return "@scrypted/owntracks";
    }
    async onPush(request: HttpRequest) {
        const user = auth.parse(request.headers['authorization']);
        if (!this.passwords.includes(user.pass)) {
            return;
        }
        const body = JSON.parse(request.body);
        this.console.log(body);

        const userNativeId = `user-${user.name}`;
        if (!deviceManager.getNativeIds().includes(userNativeId)) {
            deviceManager.onDeviceDiscovered({
                name: `Owntracks User - ${user.name}`,
                nativeId: userNativeId,
                type: ScryptedDeviceType.Sensor,
                interfaces: [ScryptedInterface.PositionSensor],
            })
        }
        const owntracksUser = new OwntracksUser(userNativeId);
        owntracksUser.position = {
            latitude: body.lat,
            longitude: body.lon,
            accuracyRadius: body.acc,
        }

        // find all regions this user belongs to, and update them.
        for (const nativeId of deviceManager.getNativeIds()) {
            if (!nativeId || nativeId.startsWith('user-'))
                continue;
            let region = new OwntracksRegion(nativeId);
            let value = region.storage.getItem(user.name);
            if (value !== null) {
                region.storage.setItem(user.name, body.inregions && body.inregions.includes(nativeId) ? 'true': 'false');
                region.sendOccupancyEvent();
            }
        }
    }
}

export default new Owntracks();
