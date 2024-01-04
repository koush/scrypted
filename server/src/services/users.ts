import { ScryptedUser } from "../db-types";
import WrappedLevel from "../level";
import { ScryptedRuntime } from "../runtime";
import crypto from 'crypto';

export class UsersService {
    users = new Map<string, ScryptedUser>();
    usersPromise: Promise<ScryptedUser[]>;

    static async addUserToDatabase(db: WrappedLevel, username: string, password: string, aclId: string) {
        const user = new ScryptedUser();
        user._id = username;
        user.aclId = aclId;
        user.token = crypto.randomBytes(16).toString('hex');
        setScryptedUserPassword(user, password, Date.now());
        await db.upsert(user);
        return user;
    }

    constructor(public scrypted: ScryptedRuntime) {
    }

    private async ensureUsersPromise() {
        if (!this.usersPromise) {
            this.usersPromise = (async() => {
                const users = new Map<string, ScryptedUser>();
                for await (const user of this.scrypted.datastore.getAll(ScryptedUser)) {
                    users.set(user._id, user);
                }
                this.users = users;
                return [...this.users.values()];
            })();
        }
        return this.usersPromise;
    }

    private updateUsersPromise() {
        this.usersPromise = Promise.resolve([...this.users.values()]);
    }

    async getAllUsers() {
        const users = await this.ensureUsersPromise();

        return users.map(user => ({
            username: user._id,
            admin: !user.aclId,
        }));
    }

    async removeUser(username: string) {
        await this.ensureUsersPromise();

        await this.scrypted.datastore.removeId(ScryptedUser, username);
        this.users.delete(username);
        this.updateUsersPromise();
    }

    async removeAllUsers() {
        await this.ensureUsersPromise();

        await this.scrypted.datastore.removeAll(ScryptedUser);
        this.users.clear();
        this.updateUsersPromise();
    }

    async addUserInternal(username: string, password: string, aclId: string) {
        await this.ensureUsersPromise();

        const user = await UsersService.addUserToDatabase(this.scrypted.datastore, username, password, aclId);
        this.users.set(username, user);
        this.updateUsersPromise();

        return user;
    }

    async addUser(username: string, password: string, aclId: string) {
        await this.addUserInternal(username, password, aclId);
    }
}

export function setScryptedUserPassword(user: ScryptedUser, password: string, timestamp: number) {
    user.salt = crypto.randomBytes(64).toString('base64');
    user.passwordHash = crypto.createHash('sha256').update(user.salt + password).digest().toString('hex');
    user.passwordDate = timestamp;
    user.token = crypto.randomBytes(16).toString('hex');
}
