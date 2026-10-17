import assert from 'assert';
import crypto from 'crypto';
import { ScryptedUser } from '../src/db-types';
import type WrappedLevel from '../src/level';
import { checkScryptedUserPassword, checkScryptedUserToken, setScryptedUserPassword } from '../src/services/users';

function createUpsertSpy() {
    const upserted: ScryptedUser[] = [];
    const db = {
        async upsert(user: ScryptedUser) {
            upserted.push(user);
            return user;
        },
    } as any as WrappedLevel;
    return { db, upserted };
}

/**
 * Create a user in the legacy uniterated sha256 format that predates PBKDF2.
 */
function createLegacyUser(username: string, password: string, timestamp: number) {
    const user = new ScryptedUser();
    user._id = username;
    user.salt = crypto.randomBytes(64).toString('base64');
    user.passwordHash = crypto.createHash('sha256').update(user.salt + password).digest().toString('hex');
    user.passwordDate = timestamp;
    user.token = crypto.randomBytes(16).toString('hex');
    return user;
}

async function testNewPasswordRoundTrips() {
    const { db } = createUpsertSpy();
    const user = new ScryptedUser();
    user._id = 'alice';
    await setScryptedUserPassword(user, 'correct horse battery staple', Date.now());

    assert(user.passwordHash.startsWith('pbkdf2$sha256$600000$'), 'unexpected hash format: ' + user.passwordHash);
    assert.strictEqual(user.passwordHash.split('$').length, 5);
    assert.strictEqual(user.salt, '', 'legacy salt field should be cleared');

    assert.strictEqual(await checkScryptedUserPassword(db, user, 'correct horse battery staple'), true);
    assert.strictEqual(await checkScryptedUserPassword(db, user, 'wrong password'), false);
    assert.strictEqual(await checkScryptedUserPassword(db, user, ''), false);
    console.log('ok: new password round trips');
}

async function testSaltIsUniquePerPassword() {
    const a = new ScryptedUser();
    const b = new ScryptedUser();
    await setScryptedUserPassword(a, 'same password', Date.now());
    await setScryptedUserPassword(b, 'same password', Date.now());
    assert.notStrictEqual(a.passwordHash, b.passwordHash, 'identical passwords must not produce identical hashes');
    console.log('ok: salt is unique per password');
}

async function testLegacyPasswordVerifiesAndUpgrades() {
    const { db, upserted } = createUpsertSpy();
    const timestamp = Date.now() - 100000;
    const user = createLegacyUser('bob', 'hunter2', timestamp);
    const originalToken = user.token;
    const originalHash = user.passwordHash;

    assert.strictEqual(await checkScryptedUserPassword(db, user, 'hunter2'), true, 'legacy password should verify');

    // the hash must have been upgraded in place and persisted exactly once.
    assert.strictEqual(upserted.length, 1, 'upgrade should persist the user');
    assert(user.passwordHash.startsWith('pbkdf2$sha256$'), 'hash should be upgraded to pbkdf2');
    assert.notStrictEqual(user.passwordHash, originalHash);

    // an upgrade is not a password change: the token and date must survive, or
    // every existing api client would break on the user's next login.
    assert.strictEqual(user.token, originalToken, 'upgrade must not rotate the api token');
    assert.strictEqual(user.passwordDate, timestamp, 'upgrade must not change passwordDate');

    // the upgraded hash still verifies, and does not re-upgrade.
    assert.strictEqual(await checkScryptedUserPassword(db, user, 'hunter2'), true);
    assert.strictEqual(upserted.length, 1, 'already upgraded user should not be persisted again');
    console.log('ok: legacy password verifies and upgrades in place');
}

async function testLegacyWrongPasswordDoesNotUpgrade() {
    const { db, upserted } = createUpsertSpy();
    const user = createLegacyUser('carol', 'hunter2', Date.now());
    const originalHash = user.passwordHash;

    assert.strictEqual(await checkScryptedUserPassword(db, user, 'not the password'), false);
    assert.strictEqual(user.passwordHash, originalHash, 'failed login must not modify the hash');
    assert.strictEqual(upserted.length, 0, 'failed login must not persist anything');
    console.log('ok: failed legacy login does not upgrade');
}

async function testTokenAuthentication() {
    const { db } = createUpsertSpy();
    const user = new ScryptedUser();
    await setScryptedUserPassword(user, 'a password', Date.now());

    // the token is accepted in place of the password, as before.
    assert.strictEqual(await checkScryptedUserPassword(db, user, user.token), true);
    assert.strictEqual(checkScryptedUserToken(user, user.token), true);
    assert.strictEqual(checkScryptedUserToken(user, 'wrong token'), false);
    assert.strictEqual(checkScryptedUserToken(user, ''), false);

    // a user with no token must never authenticate on an empty token.
    const tokenless = new ScryptedUser();
    assert.strictEqual(checkScryptedUserToken(tokenless, ''), false);
    assert.strictEqual(checkScryptedUserToken(tokenless, undefined as any), false);
    console.log('ok: token authentication');
}

async function testMalformedHashesAreRejected() {
    const { db } = createUpsertSpy();
    const malformed = [
        '',
        'pbkdf2',
        'pbkdf2$sha256',
        'pbkdf2$sha256$0$c2FsdA==$aGFzaA==',
        'pbkdf2$sha256$notanumber$c2FsdA==$aGFzaA==',
        'pbkdf2$sha256$600000$c2FsdA==$',
        'pbkdf2$$600000$c2FsdA==$aGFzaA==',
    ];
    for (const passwordHash of malformed) {
        const user = new ScryptedUser();
        user.passwordHash = passwordHash;
        assert.strictEqual(await checkScryptedUserPassword(db, user, 'anything'), false, 'accepted malformed hash: ' + passwordHash);
    }

    // a user with no credentials at all must never authenticate.
    const empty = new ScryptedUser();
    assert.strictEqual(await checkScryptedUserPassword(db, empty, 'anything'), false);
    assert.strictEqual(await checkScryptedUserPassword(db, empty, ''), false);
    console.log('ok: malformed hashes are rejected');
}

async function testUpgradeFailureStillAuthenticates() {
    // if the database write fails, the user must still be able to log in.
    const db = {
        async upsert() {
            throw new Error('disk full');
        },
    } as any as WrappedLevel;
    const user = createLegacyUser('dave', 'hunter2', Date.now());
    assert.strictEqual(await checkScryptedUserPassword(db, user, 'hunter2'), true);
    console.log('ok: upgrade failure still authenticates');
}

async function test() {
    await testNewPasswordRoundTrips();
    await testSaltIsUniquePerPassword();
    await testLegacyPasswordVerifiesAndUpgrades();
    await testLegacyWrongPasswordDoesNotUpgrade();
    await testTokenAuthentication();
    await testMalformedHashesAreRejected();
    await testUpgradeFailureStillAuthenticates();
    console.log();
    console.log('all password tests passed');
}

test();
