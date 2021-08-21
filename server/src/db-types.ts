import { LevelDocument } from "./level";

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
    salt: string;
}

export class ScryptedAlert extends ScryptedDocument {
    timestamp: number;
    title: string;
    path: string;
    message: string;
}
