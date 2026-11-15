const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const sdkRequire = createRequire(require.resolve('@scrypted/sdk'));
const ts = sdkRequire('typescript');
const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../src/reolink-api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
});

const denied = [{ cmd: 'GetDevInfo', code: 1, error: { rspCode: -6, detail: 'please login first' } }];
const success = [{ cmd: 'GetDevInfo', code: 0, value: { DevInfo: { model: 'Test Camera' } } }];
const response = body => ({ statusCode: 200, headers: new Headers(), body });
const options = () => ({ url: new URL('http://camera/api.cgi?cmd=GetDevInfo'), responseType: 'json' });
function deferred() {
    let resolve;
    const promise = new Promise(r => resolve = r);
    return { promise, resolve };
}
function harness(fetch, login = async () => ({ parameters: { token: 'new-token' }, leaseTimeSeconds: 3600 })) {
    const logins = [];
    const requests = [];
    const dependencies = {
        '@scrypted/common/src/http-auth-fetch': {
            authHttpFetch: async opts => {
                const chunks = [];
                if (opts.body)
                    for await (const chunk of opts.body) chunks.push(Buffer.from(chunk));
                const request = { ...opts, url: new URL(opts.url), bytes: Buffer.concat(chunks) };
                requests.push(request);
                return fetch(request, requests.length);
            },
        },
        stream: require('node:stream'),
        '@scrypted/common/src/sleep': {},
        './probe': { getLoginParameters: async (...args) => { logins.push(args); return login(...args); } },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(name => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw new Error(`Unexpected test dependency: ${name}`);
    }, module, module.exports);
    const client = new module.exports.ReolinkCameraClient('camera', 'admin', 'secret', 0, { log() {}, warn() {}, error() {} });
    client.parameters = { token: 'old-token' };
    client.tokenLease = Date.now() + 3600000;
    return { client, logins, requests };
}

test('rejected unexpired token is replaced and the request retried once', async () => {
    const h = harness(req => response(req.url.searchParams.get('token') === 'old-token' ? denied : success));
    assert.deepEqual((await h.client.requestWithLogin(options())).body, success);
    assert.equal(h.logins.length, 1);
    assert.equal(h.logins[0][3], true, 'recovery must perform an explicit token login');
    assert.equal(h.requests.length, 2);
});

test('rejected infinite credential lease changes to token without stale query credentials', async () => {
    const h = harness((req, n) => response(n === 1 ? denied : success));
    h.client.parameters = { user: 'admin', password: 'secret' };
    h.client.tokenLease = Infinity;
    const input = options();
    await h.client.requestWithLogin(input);
    assert.equal(h.requests[1].url.searchParams.get('token'), 'new-token');
    assert.equal(h.requests[1].url.searchParams.has('user'), false);
    assert.equal(h.requests[1].url.searchParams.has('password'), false);
    assert.equal(input.url.searchParams.has('token'), false, 'caller URL must not be mutated');
    assert.equal(input.url.searchParams.has('password'), false);
});

test('POST retry replays the complete consumed body', async () => {
    const bytes = Buffer.from(JSON.stringify([{ cmd: 'GetOsd', param: { channel: 0 } }]));
    const h = harness((req, n) => response(n === 1 ? denied : success));
    await h.client.requestWithLogin({ ...options(), method: 'POST' }, Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]));
    assert.equal(h.requests.length, 2);
    for (const req of h.requests) assert.deepEqual(req.bytes, bytes);
});

test('a second rejection ends the retry and invalidates its session', async () => {
    const h = harness(() => response(denied));
    assert.deepEqual((await h.client.requestWithLogin(options())).body, denied);
    assert.equal(h.requests.length, 2);
    assert.equal(h.logins.length, 1);
    assert.ok(!(h.client.tokenLease > Date.now()), 'a rejected retry must not keep a valid lease');
});

test('non-authentication errors and network failures do not trigger login or replay', async () => {
    for (const result of [[], [{ error: { rspCode: -5 } }], [{ error: { rspCode: -17 } }]]) {
        const h = harness(() => response(result));
        assert.strictEqual((await h.client.requestWithLogin(options())).body, result);
        assert.equal(h.logins.length, 0);
        assert.equal(h.requests.length, 1);
    }
    const h = harness(() => { throw new Error('network failure'); });
    await assert.rejects(h.client.requestWithLogin(options()), /network failure/);
    assert.equal(h.logins.length, 0);
    assert.equal(h.requests.length, 1);
});

test('mixed batch is invalidated but never replayed after a command already succeeded', async () => {
    const mixed = [{ cmd: 'PtzCtrl', code: 0, value: { rspCode: 200 } }, ...denied];
    const h = harness(() => response(mixed));
    assert.strictEqual((await h.client.requestWithLogin(options())).body, mixed);
    assert.equal(h.requests.length, 1);
    assert.ok(!(h.client.tokenLease > Date.now()));
});

test('JSON authentication errors in snapshot buffers and text retry without changing successful body types', async () => {
    for (const responseType of [undefined, 'text']) {
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9]);
        const good = responseType === 'text' ? 'response text' : jpeg;
        const bad = responseType === 'text' ? JSON.stringify(denied) : Buffer.from(JSON.stringify(denied));
        const h = harness((req, n) => response(n === 1 ? bad : good));
        assert.strictEqual((await h.client.requestWithLogin({ ...options(), responseType })).body, good);
        assert.equal(h.logins.length, 1);
        assert.equal(h.requests.length, 2);
    }
});

test('healthy JPEG and malformed error text pass through unchanged', async () => {
    for (const body of [Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'not json', Buffer.from('{broken')]) {
        const h = harness(() => response(body));
        assert.strictEqual((await h.client.requestWithLogin({ ...options(), responseType: undefined })).body, body);
        assert.equal(h.logins.length, 0);
        assert.equal(h.requests.length, 1);
    }
});

test('concurrent initial login requests share one login exchange', async () => {
    const ready = deferred();
    const release = deferred();
    const h = harness(() => response(success), async () => {
        ready.resolve();
        await release.promise;
        return { parameters: { token: 'new-token' }, leaseTimeSeconds: 3600 };
    });
    h.client.parameters = undefined;
    h.client.tokenLease = undefined;
    const calls = Array.from({ length: 5 }, () => h.client.requestWithLogin(options()));
    await ready.promise;
    release.resolve();
    await Promise.all(calls);
    assert.equal(h.logins.length, 1);
    assert.equal(h.requests.length, 5);
});

test('simultaneous and late old-session rejections share the new session', async () => {
    const bothOld = deferred();
    const releaseOld = deferred();
    const loginStarted = deferred();
    const releaseLogin = deferred();
    let oldCount = 0;
    const h = harness(async req => {
        if (req.url.searchParams.get('token') !== 'old-token') return response(success);
        if (++oldCount === 2) bothOld.resolve();
        await releaseOld.promise;
        return response(denied);
    }, async () => {
        loginStarted.resolve();
        await releaseLogin.promise;
        return { parameters: { token: 'new-token' }, leaseTimeSeconds: 3600 };
    });
    const calls = [h.client.requestWithLogin(options()), h.client.requestWithLogin(options())];
    await bothOld.promise;
    releaseOld.resolve();
    await loginStarted.promise;
    releaseLogin.resolve();
    assert.deepEqual((await Promise.all(calls)).map(r => r.body), [success, success]);
    assert.equal(h.logins.length, 1);
    assert.equal(h.requests.length, 4);

    const late = deferred();
    const entered = deferred();
    let old = 0;
    const delayed = harness(async req => {
        if (req.url.searchParams.get('token') === 'old-token') {
            if (++old === 1) { entered.resolve(); await late.promise; }
            return response(denied);
        }
        return response(success);
    });
    const first = delayed.client.requestWithLogin(options());
    await entered.promise;
    await delayed.client.requestWithLogin(options());
    late.resolve();
    await first;
    assert.equal(delayed.logins.length, 1, 'late rejection must not invalidate the new session');
    assert.equal(delayed.requests.length, 4);
});

test('failed login releases the shared promise so a later request can recover', async () => {
    let exchanges = 0;
    const h = harness(() => response(success), async () => {
        if (++exchanges === 1) throw new Error('login unavailable');
        return { parameters: { token: 'new-token' }, leaseTimeSeconds: 3600 };
    });
    h.client.parameters = undefined;
    h.client.tokenLease = undefined;
    const first = await Promise.allSettled(Array.from({ length: 3 }, () => h.client.requestWithLogin(options())));
    assert.ok(first.every(r => r.status === 'rejected' && /login unavailable/.test(r.reason.message)));
    assert.equal(h.logins.length, 1);
    assert.equal(h.requests.length, 0);
    assert.deepEqual((await h.client.requestWithLogin(options())).body, success);
    assert.equal(h.logins.length, 2);
});

test('concurrent lease renewals share logout and login, then all use the renewed session', async () => {
    const reachedLogout = deferred();
    const releaseLogout = deferred();
    const h = harness(async req => {
        if (req.url.searchParams.get('cmd') === 'Logout') {
            reachedLogout.resolve();
            await releaseLogout.promise;
        }
        return response(success);
    });
    h.client.tokenLease = Date.now() - 1;
    const calls = Array.from({ length: 4 }, () => h.client.requestWithLogin(options()));
    await reachedLogout.promise;
    releaseLogout.resolve();
    await Promise.all(calls);
    assert.equal(h.logins.length, 1);
    const logouts = h.requests.filter(req => req.url.searchParams.get('cmd') === 'Logout');
    assert.equal(logouts.length, 1);
    assert.equal(logouts[0].url.searchParams.get('token'), 'old-token');
    const queries = h.requests.filter(req => req.url.searchParams.get('cmd') !== 'Logout');
    assert.equal(queries.length, 4);
    assert.ok(queries.every(req => req.url.searchParams.get('token') === 'new-token'));
});
