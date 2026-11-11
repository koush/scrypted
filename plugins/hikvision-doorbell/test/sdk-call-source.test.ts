import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { SdkCallSource, SdkCallSourceOptions } from '../src/sdk/sdk-call-source';

const PASSWORD = 'not-a-real-secret';

class FakeChild extends EventEmitter
{
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    signals: string[] = [];
    written = '';

    constructor ()
    {
        super();
        this.stdin.on ('data', (chunk) => this.written += chunk);
    }

    kill (signal?: string)
    {
        this.signals.push (signal);
        return true;
    }

    line (message: object)
    {
        this.stdout.write (JSON.stringify (message) + '\n');
    }

    exit (code = 1)
    {
        this.emit ('exit', code, null);
    }
}

const quietConsole = { log () {}, info () {}, warn () {}, error () {}, debug () {} } as unknown as Console;
const settle = () => new Promise ((resolve) => setImmediate (resolve));

function setup (extra: Partial<SdkCallSourceOptions> = {})
{
    const children: FakeChild[] = [];
    const calls: { cmd: string, args: string[], opts: any }[] = [];
    const spawnFn = ((cmd: string, args: string[], opts: any) => {
        const child = new FakeChild();
        children.push (child);
        calls.push ({ cmd, args, opts });
        return child;
    }) as any;
    const source = new SdkCallSource ({
        libDir: '/sdk/lib', scriptPath: '/plugin/fs/hcnetsdk_sidecar.py',
        host: '192.0.2.1', port: 8000, username: 'admin', password: PASSWORD,
        diagnostics: false, console: quietConsole, spawnFn, ...extra,
    });
    const events: any[][] = [];
    for (const name of ['ready', 'ring', 'end', 'down']) {
        source.on (name, (...args) => events.push ([name, ...args]));
    }
    return { source, children, calls, events };
}

test('start spawns python with script and libDir', () => {
    const { source, calls } = setup();
    source.start();
    assert.equal (calls.length, 1);
    assert.equal (calls[0].cmd, 'python3');
    assert.deepEqual (calls[0].args, ['/plugin/fs/hcnetsdk_sidecar.py', '/sdk/lib']);
    assert.equal (calls[0].opts.env.LD_LIBRARY_PATH, '/sdk/lib');
    assert.ok (!JSON.stringify (calls[0].args).includes (PASSWORD));
    assert.ok (!Object.values (calls[0].opts.env).includes (PASSWORD));
    source.stop();
});

test('writes credentials once to stdin', async () => {
    const { source, children } = setup();
    source.start();
    await settle();
    const lines = children[0].written.split ('\n').filter (Boolean);
    assert.equal (lines.length, 1);
    assert.deepEqual (JSON.parse (lines[0]),
        { host: '192.0.2.1', port: 8000, username: 'admin', password: PASSWORD, diagnostics: false });
    source.stop();
});

test('emits events from stdout lines', async () => {
    const { source, children, events } = setup();
    source.start();
    children[0].line ({ type: 'ready', sdkVersion: '6.1.8.101' });
    children[0].line ({ type: 'ring' });
    children[0].line ({ type: 'end' });
    children[0].line ({ type: 'disconnected' });
    children[0].line ({ type: 'reconnected' });
    await settle();
    assert.deepEqual (events.map ((e) => e[0]), ['ready', 'ring', 'end', 'down', 'ready']);
    assert.equal (events[0][1], '6.1.8.101');
    assert.equal (typeof events[3][1], 'string');
    assert.equal (events[4][1], '6.1.8.101');
    source.stop();
});

test('restarts after exit with backoff', async (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    const { source, children, events } = setup();
    source.start();
    children[0].exit();
    assert.deepEqual (events.map ((e) => e[0]), ['down']);
    t.mock.timers.tick (4999);
    assert.equal (children.length, 1);
    t.mock.timers.tick (1);
    assert.equal (children.length, 2);
    children[1].exit();
    t.mock.timers.tick (9999);
    assert.equal (children.length, 2);
    t.mock.timers.tick (1);
    assert.equal (children.length, 3);
    children[2].line ({ type: 'ready', sdkVersion: '6.1.8.101' });
    await settle();
    children[2].exit();
    t.mock.timers.tick (5000);
    assert.equal (children.length, 4);
    source.stop();
});

test('stop kills child and never restarts', (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    const { source, children } = setup();
    source.start();
    source.stop();
    assert.ok (children[0].stdin.writableEnded);
    t.mock.timers.tick (60000);
    assert.deepEqual (children[0].signals, ['SIGTERM']);
    children[0].exit (0);
    t.mock.timers.tick (60000);
    assert.equal (children.length, 1);
});

test('forwards raw lines as message events', async () => {
    const { source, children, events } = setup();
    const messages: any[] = [];
    source.on ('message', (message) => messages.push (message));
    source.start();
    children[0].line ({ type: 'raw', source: 'alarm', command: 4403, data: { byAlarmType: 7 } });
    await settle();
    assert.equal (messages.length, 1);
    assert.equal (messages[0].type, 'raw');
    assert.deepEqual (events, []);
    source.stop();
});

test('wrong password or locked account stops restarts', async (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    for (const [code, words] of [[1, 'password'], [153, 'locked']] as const) {
        const { source, children, events } = setup();
        source.start();
        children[0].line ({ type: 'error', stage: 'login', code, message: 'NET_DVR_Login_V30 failed' });
        await settle();
        children[0].exit (2);
        assert.equal (events.length, 1);
        assert.equal (events[0][0], 'down');
        assert.match (events[0][1], new RegExp (words));
        t.mock.timers.tick (120000);
        assert.equal (children.length, 1);
        source.stop();
    }
});

test('other login errors keep retrying', async (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    const { source, children } = setup();
    source.start();
    children[0].line ({ type: 'error', stage: 'login', code: 7, message: 'NET_DVR_Login_V30 failed' });
    await settle();
    children[0].exit (2);
    t.mock.timers.tick (5000);
    assert.equal (children.length, 2);
    source.stop();
});
