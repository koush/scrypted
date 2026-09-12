import { ScryptedUser } from "../db-types";
import WrappedLevel from "../level";
import { ScryptedRuntime } from "../runtime";
import crypto from 'crypto';

export class UsersService {
    users = new Map<string, ScryptedUser>();
    usersPromise!: Promise<ScryptedUser[]>;

    static async addUserToDatabase(db: WrappedLevel, username: string, password: string, aclId?: string) {
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

    async addUserInternal(username: string, password: string, aclId?: string) {
        await this.ensureUsersPromise();

        const user = await UsersService.addUserToDatabase(this.scrypted.datastore, username, password, aclId);
        this.users.set(username, user);
        this.updateUsersPromise();

        return user;
    }

    async addUser(username: string, password: string, aclId: string) {
        await this.addUserInternal(username, password, aclId);
    }

    async getOidcSubject(username: string): Promise<string | undefined> {
        await this.ensureUsersPromise();
        return this.users.get(username)?.oidcSubject;
    }

    async linkOidcSubject(username: string, sub: string): Promise<void> {
        await this.ensureUsersPromise();
        const user = this.users.get(username);
        if (!user)
            throw new Error(`User "${username}" not found`);
        const existing = await this.findUserByOidcSubject(sub);
        if (existing && existing._id !== username)
            throw new Error('OIDC subject is already linked to another account');
        const updated = Object.assign(new ScryptedUser(), user, { oidcSubject: sub });
        await this.scrypted.datastore.upsert(updated);
        this.users.set(updated._id, updated);
        this.updateUsersPromise();
    }

    async unlinkOidcSubject(username: string): Promise<void> {
        await this.ensureUsersPromise();
        const user = this.users.get(username);
        if (!user)
            throw new Error(`User "${username}" not found`);
        const updated = Object.assign(new ScryptedUser(), user);
        delete updated.oidcSubject;
        await this.scrypted.datastore.upsert(updated);
        this.users.set(updated._id, updated);
        this.updateUsersPromise();
    }

    async findUserByOidcSubject(sub: string): Promise<ScryptedUser | undefined> {
        await this.ensureUsersPromise();
        for (const user of this.users.values()) {
            if (user.oidcSubject === sub)
                return user;
        }
        return undefined;
    }

    async findOrCreateOidcUser(username: string, sub: string, isAdmin: boolean): Promise<ScryptedUser> {
        await this.ensureUsersPromise();

        const resolveAclId = (): string | undefined => {
            if (isAdmin)
                return undefined;
            const device = this.scrypted.findPluginDevice('@scrypted/core', `user:${username}`);
            return device?._id ?? '~oidc-pending~';
        };

        const syncAndPersist = async (user: ScryptedUser): Promise<ScryptedUser> => {
            const desiredAclId = resolveAclId();
            const changed = user.oidcSubject !== sub || user.aclId !== desiredAclId;
            if (!changed)
                return user;
            const updated = Object.assign(new ScryptedUser(), user, { oidcSubject: sub, aclId: desiredAclId });
            await this.scrypted.datastore.upsert(updated);
            this.users.set(updated._id, updated);
            this.updateUsersPromise();
            return updated;
        };

        const bySubject = await this.findUserByOidcSubject(sub);
        if (bySubject)
            return syncAndPersist(bySubject);

        if (this.users.has(username))
            throw new Error(`Username "${username}" is already taken by a local account. An admin must resolve the conflict.`);

        const newUser = new ScryptedUser();
        newUser._id = username;
        newUser.aclId = resolveAclId();
        newUser.oidcSubject = sub;
        newUser.token = crypto.randomBytes(16).toString('hex');
        setScryptedUserPassword(newUser, crypto.randomBytes(32).toString('hex'), Date.now());
        await this.scrypted.datastore.upsert(newUser);
        this.users.set(newUser._id, newUser);
        this.updateUsersPromise();
        return newUser;
    }
}

export function setScryptedUserPassword(user: ScryptedUser, password: string, timestamp: number) {
    user.salt = crypto.randomBytes(64).toString('base64');
    user.passwordHash = crypto.createHash('sha256').update(user.salt + password).digest().toString('hex');
    user.passwordDate = timestamp;
    user.token = crypto.randomBytes(16).toString('hex');
}
