import { LevelDocument } from "./level";
import { ScryptedNativeId, SystemDeviceState } from "@scrypted/types";

export class ScryptedDocument implements LevelDocument {
    _id?: string;
    _documentType?: string;
}

export class Settings extends ScryptedDocument {
    value?: any;
}

export class Plugin extends ScryptedDocument {
    packageJson?: any;
    zip?: string;
}

export class ScryptedUser extends ScryptedDocument {
    passwordDate: number;
    passwordHash: string;
    token: string;
    salt: string;
    aclId: string;
}

export class ScryptedAlert extends ScryptedDocument {
    timestamp: number;
    title: string;
    path: string;
    message: string;
}

export class PluginDevice extends ScryptedDocument {
    constructor(id?: string) {
        super();
        this._id = id;
    }
    nativeId: ScryptedNativeId;
    pluginId: string;
    state: { [property: string]: SystemDeviceState };
    stateVersion: number;
    storage: { [key: string]: string };
}
