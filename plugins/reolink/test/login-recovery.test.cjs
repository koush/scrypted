const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { test } = require('node:test');
const sdkRequire = createRequire(require.resolve('@scrypted/sdk'));
const ts = sdkRequire('typescript');
const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../src/reolink-api.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
});

const denied = [{ cmd: 'GetDevInfo', code: 1, error: { rspCode: -6, detail: 'please login first' } }];
const success = [{ cmd: 'GetDevInfo', code: 0, value: { DevInfo: { model: 'Test Camera' } } }];
const response = (body, type = 'text/html') => ({ statusCode: 200, headers: new Headers({ 'Content-Type': type }), body });
const options = () => ({ url: new URL('http://camera/api.cgi?cmd=GetDevInfo'), responseType: 'json' });
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

for (const [kind, type] of [['API', 'text/html'], ['snapshot', 'text/html'], ['snapshot', 'application/json; charset=utf-8']]) {
    test('invalidate without replay for ' + kind + ' with ' + type, async () => {
        const rejection = kind === 'API' ? denied : Buffer.from(JSON.stringify(denied));
        const h = harness((req, n) => response(n === 1 ? rejection : success, type));
        const first = kind === 'API' ? (await h.client.requestWithLogin(options())).body : await h.client.jpegSnapshot();
        assert.equal(first, rejection);
        assert.equal(h.requests.length, 1);
        assert.equal(h.logins.length, 0);
        assert.equal((await h.client.requestWithLogin(options())).body, success);
        assert.equal(h.logins.length, 1);
        assert.equal(h.requests[1].url.searchParams.get('token'), 'new-token');
    });
}

test('only inspect snapshot errors under the expected media types', async () => {
    for (const [type, body] of [
        ['image/jpeg', Buffer.from(JSON.stringify(denied))],
        ['text/html', Buffer.from('<html>Camera busy</html>')],
    ]) {
        const h = harness(() => response(body, type));
        assert.equal(await h.client.jpegSnapshot(), body);
        assert.equal(h.client.parameters.token, 'old-token');
    }
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
