import { ScryptedUser } from "../db-types";
import { ScryptedRuntime } from "../runtime";
import crypto from 'crypto';

export class UsersService {
    constructor(public scrypted: ScryptedRuntime) {
    }

    async getAllUsers() {
        const users: ScryptedUser[] = [];
        for await (const user of this.scrypted.datastore.getAll(ScryptedUser)) {
            users.push(user);
        }

        return users.map(user => ({
            username: user._id,
            admin: !user.aclId,
        }));
    }

    async removeUser(username: string) {
        await this.scrypted.datastore.removeId(ScryptedUser, username);
    }

    async removeAllUsers() {
        await this.scrypted.datastore.removeAll(ScryptedUser);
    }

    async addUser(username: string, password: string, aclId: string) {
        const user = new ScryptedUser();
        user._id = username;
        user.aclId = aclId;
        setScryptedUserPassword(user, password, Date.now());
        await this.scrypted.datastore.upsert(user);
    }
}

export function setScryptedUserPassword(user: ScryptedUser, password: string, timestamp: number) {
    user.salt = crypto.randomBytes(64).toString('base64');
    user.passwordHash = crypto.createHash('sha256').update(user.salt + password).digest().toString('hex');
    user.passwordDate = timestamp;
    user.token = crypto.randomBytes(16).toString('hex');
}
