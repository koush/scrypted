import { ScryptedUser } from "../db-types";
import WrappedLevel from "../level";
import { ScryptedRuntime } from "../runtime";
import crypto from 'crypto';
import { promisify } from 'util';

export class UsersService {
    users = new Map<string, ScryptedUser>();
    usersPromise!: Promise<ScryptedUser[]>;

    static async addUserToDatabase(db: WrappedLevel, username: string, password: string, aclId?: string) {
        const user = new ScryptedUser();
        user._id = username;
        user.aclId = aclId;
        // setScryptedUserPassword assigns the token.
        await setScryptedUserPassword(user, password, Date.now());
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
}

/**
 * Password storage.
 *
 * Passwords are hashed with PBKDF2-HMAC-SHA256. The iteration count follows the
 * OWASP Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256.
 *
 * The encoded hash is self describing so the parameters can be raised later
 * without invalidating existing passwords:
 *
 *   pbkdf2$sha256$<iterations>$<salt-base64>$<hash-base64>
 *
 * Passwords created before this format was introduced were stored as a single
 * uniterated sha256 of (salt + password), which is fast enough to be brute
 * forced offline if the database is ever disclosed. Those hashes are still
 * accepted, and are transparently upgraded to PBKDF2 the next time the user
 * successfully authenticates. See checkScryptedUserPassword.
 */

const PBKDF2_PREFIX = 'pbkdf2';
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_SALT_LENGTH = 32;
export const PBKDF2_ITERATIONS = 600000;

const pbkdf2 = promisify(crypto.pbkdf2);

function timingSafeEqualString(a: string | undefined, b: string | undefined): boolean {
    const ab = Buffer.from(a || '', 'utf8');
    const bb = Buffer.from(b || '', 'utf8');
    // lengths are not secret, and timingSafeEqual requires equal lengths.
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}

interface Pbkdf2Hash {
    digest: string;
    iterations: number;
    salt: Buffer;
    hash: Buffer;
}

function parsePbkdf2Hash(passwordHash: string | undefined): Pbkdf2Hash | undefined {
    if (!passwordHash?.startsWith(`${PBKDF2_PREFIX}$`))
        return undefined;

    const parts = passwordHash.split('$');
    if (parts.length !== 5)
        return undefined;

    const digest = parts[1]!;
    const iterations = parseInt(parts[2]!);
    if (!digest || !iterations || iterations < 1)
        return undefined;

    try {
        return {
            digest,
            iterations,
            salt: Buffer.from(parts[3]!, 'base64'),
            hash: Buffer.from(parts[4]!, 'base64'),
        };
    }
    catch (e) {
        return undefined;
    }
}

async function createPbkdf2Hash(password: string, salt: Buffer, iterations: number, keyLength: number, digest: string) {
    const hash = await pbkdf2(password, salt, iterations, keyLength, digest);
    return `${PBKDF2_PREFIX}$${digest}$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify a password against the legacy uniterated sha256 format.
 */
function checkLegacyPassword(user: ScryptedUser, password: string): boolean {
    if (!user.salt || !user.passwordHash)
        return false;
    const sha = crypto.createHash('sha256').update(user.salt + password).digest().toString('hex');
    return timingSafeEqualString(sha, user.passwordHash);
}

/**
 * Verify a password against the PBKDF2 format.
 */
async function checkPbkdf2Password(user: ScryptedUser, password: string): Promise<boolean> {
    const parsed = parsePbkdf2Hash(user.passwordHash);
    if (!parsed)
        return false;
    const { digest, iterations, salt, hash } = parsed;
    if (!hash.length)
        return false;
    const actual = await pbkdf2(password, salt, iterations, hash.length, digest);
    return crypto.timingSafeEqual(hash, actual);
}

/**
 * Check a user's long lived api token. The token is high entropy, so it does
 * not require a slow hash, but it must still be compared in constant time.
 */
export function checkScryptedUserToken(user: ScryptedUser, token: string): boolean {
    if (!user.token)
        return false;
    return timingSafeEqualString(user.token, token);
}

/**
 * Authenticate a user with either their password or their api token.
 *
 * A password still stored in the legacy sha256 format is rehashed with PBKDF2
 * and persisted on success. The rehash deliberately preserves the existing
 * token and passwordDate: the password itself has not changed, and rotating
 * the token here would silently invalidate every existing api client.
 */
export async function checkScryptedUserPassword(db: WrappedLevel, user: ScryptedUser, password: string): Promise<boolean> {
    if (!password)
        return false;

    if (await checkPbkdf2Password(user, password))
        return true;

    if (checkLegacyPassword(user, password)) {
        try {
            user.salt = '';
            user.passwordHash = await createPbkdf2Hash(password, crypto.randomBytes(PBKDF2_SALT_LENGTH), PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
            await db.upsert(user);
        }
        catch (e) {
            // the password is valid even if the upgrade could not be persisted.
            console.warn('Failed to upgrade password hash to PBKDF2.', e);
        }
        return true;
    }

    return checkScryptedUserToken(user, password);
}

export async function setScryptedUserPassword(user: ScryptedUser, password: string, timestamp: number) {
    // the salt is stored inside passwordHash. it is cleared here so a stale
    // legacy salt is never left behind on the user document.
    user.salt = '';
    user.passwordHash = await createPbkdf2Hash(password, crypto.randomBytes(PBKDF2_SALT_LENGTH), PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
    user.passwordDate = timestamp;
    user.token = crypto.randomBytes(16).toString('hex');
}
