const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { test } = require('node:test');
const sdkRequire = createRequire(require.resolve('@scrypted/sdk'));
const ts = sdkRequire('typescript');

function loadSource(filename, dependencies = {}) {
    // Isolate SDK device timers, network I/O, and FFmpeg while exercising the real methods.
    const source = readFileSync(resolve(__dirname, '../src', filename), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            esModuleInterop: true,
        },
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(name => {
        if (Object.hasOwn(dependencies, name))
            return dependencies[name];
        throw new Error(`Unexpected test dependency: ${name}`);
    }, module, module.exports);
    return module.exports;
}

const { getChannelIntercomStreamUrl } = loadSource('nvr/intercom.ts');
const rtsp = loadSource('../../rtsp/src/rtsp.ts', {
    '@scrypted/common/src/promise-utils': {},
    '@scrypted/sdk': {},
    url: require('node:url'),
    '../../ffmpeg-camera/src/common': { CameraBase: class {}, CameraProviderBase: class {} },
});
const { ReolinkNvrCamera } = loadSource('nvr/camera.ts', {
    '@scrypted/common/src/sleep': {},
    '@scrypted/sdk': { ScryptedDeviceBase: class {} },
    '@scrypted/sdk/storage-settings': {},
    '../../../rtsp/src/rtsp': rtsp,
    '../onvif-api': { connectCameraAPI: (...args) => args },
    '../onvif-intercom': {},
    './intercom': { getChannelIntercomStreamUrl },
});

function profileClient(streams) {
    const calls = [];
    return {
        calls,
        async getProfiles() {
            return streams.map(([token]) => ({ $: { token } }));
        },
        async getStreamUrl(token) {
            calls.push(token);
            const stream = streams.find(([candidate]) => candidate === token);
            assert.ok(stream, 'A specific profile token must be supplied');
            return stream[1];
        },
    };
}

test('selects channel four, not the first Hub profile or a substream', async () => {
    const client = profileClient([
        ['first', 'rtsp://hub:554/Preview_01_main'],
        ['doorbell-sub', 'rtsp://hub:554/Preview_04_sub'],
        ['doorbell-main', 'rtsp://hub:554/Preview_04_main'],
    ]);
    assert.equal(await getChannelIntercomStreamUrl(client, 3), 'rtsp://hub:554/Preview_04_main');
});

test('uses URI channel mapping rather than profile order or token naming', async () => {
    const client = profileClient([
        ['arbitrary', 'rtsp://hub:8554/h264Preview_04_main?transport=unicast'],
        ['Profile000_MainStream', 'rtsp://hub:8554/Preview_01_main'],
    ]);
    assert.equal(await getChannelIntercomStreamUrl(client, 3),
        'rtsp://hub:8554/h264Preview_04_main?transport=unicast');
});

test('selects zero-based channel zero and supports multi-digit channels', async () => {
    for (const [channel, path] of [[0, 'Preview_01_main'], [11, 'Preview_12_main']]) {
        const uri = `rtsp://hub/${path}`;
        assert.equal(await getChannelIntercomStreamUrl(profileClient([['main', uri]]), channel), uri);
    }
});

test('does not fall back to a different camera or substream', async () => {
    for (const streams of [
        [],
        [['other', 'rtsp://hub/Preview_01_main']],
        [['sub', 'rtsp://hub/Preview_04_sub']],
        [['unknown', 'rtsp://hub/unknown']],
    ]) {
        await assert.rejects(getChannelIntercomStreamUrl(profileClient(streams), 3),
            /ONVIF main stream not found for Reolink channel 3/);
    }
});

test('rejects invalid channel values before contacting the Hub', async () => {
    for (const channel of [-1, 0.5, NaN, Infinity, undefined, '3']) {
        const client = profileClient([]);
        client.getProfiles = () => assert.fail('Invalid channels must not contact the Hub');
        await assert.rejects(getChannelIntercomStreamUrl(client, channel),
            /Invalid Reolink intercom channel/);
    }
});

test('surfaces ONVIF lookup and malformed URI failures', async () => {
    const failure = new Error('ONVIF request failed');
    const client = profileClient([['main', 'rtsp://hub/Preview_04_main']]);
    client.getStreamUrl = async () => { throw failure; };
    await assert.rejects(getChannelIntercomStreamUrl(client, 3), error => error === failure);
    await assert.rejects(getChannelIntercomStreamUrl(
        profileClient([['main', 'not a URI']]), 3), /Invalid URL/);
});

function intercomFixture({ backchannel = true, udpFails = false } = {}) {
    const connections = [];
    const sends = [];
    let audio;
    let teardowns = 0;
    const sdp = {
        msections: backchannel ? [{
            type: 'audio',
            direction: 'sendonly',
            control: 'trackID=2',
            rtpmaps: [{ ffmpegEncoder: 'pcm_mulaw', clock: 8000, payloadType: 0, channels: 1 }],
        }] : [],
    };
    class RtspClient {
        constructor(url) {
            connections.push(url);
            this.client = { on() {} };
        }
        async options() {}
        async describe() { return { body: Buffer.from('fixture SDP') }; }
        async request(method, headers) {
            assert.equal(method, 'SETUP');
            if (udpFails && headers.Transport.startsWith('RTP/AVP;'))
                throw new Error('UDP transport unsupported');
            return { headers: { transport: 'fixture transport', session: 'session;timeout=60' } };
        }
        async play() {}
        safeTeardown() { teardowns++; }
        send(data, channel) { sends.push({ data, channel }); }
    }
    const { OnvifIntercom } = loadSource('onvif-intercom.ts', {
        '@scrypted/common/src/listen-cluster': {
            async createBindZero() {
                return {
                    port: 10000,
                    server: {
                        on() {},
                        send(data, port, ip) { sends.push({ data, port, ip }); },
                    },
                };
            },
        },
        '@scrypted/common/src/rtsp-server': {
            RtspClient,
            parseSemicolonDelimited: () => ({ server_port: '20000-20001', ssrc: '00000001' }),
        },
        '@scrypted/common/src/sdp-utils': { parseSdp: () => sdp },
        '@scrypted/sdk': {
            __esModule: true,
            default: { mediaManager: { async convertMediaObjectToJSON() { return {}; } } },
            ScryptedMimeTypes: { FFmpegInput: 'fixture' },
        },
        crypto: require('node:crypto'),
        '../../../external/werift/packages/rtp/src/rtp/rtp': {
            RtpPacket: { deSerialize: packet => packet },
        },
        '../../homekit/src/types/camera/jitter-buffer': { nextSequenceNumber: n => n + 1 },
        '../../webrtc/src/rtp-forwarders': {
            async startRtpForwarderProcess(console, input, options) {
                audio = options.audio;
                return { kill() {}, killPromise: new Promise(() => {}) };
            },
        },
    });
    const camera = {
        console: { log() {}, error() {} },
        storage: { getItem() { throw new Error('Do not read child camera credentials'); } },
        getIPAddress() { throw new Error('Do not use the child camera IP for audio'); },
        addRtspCredentials(uri) {
            const url = new URL(uri);
            url.username = 'hub-admin';
            url.password = 'p@ss:/?#';
            return url.toString();
        },
    };
    const intercom = new OnvifIntercom(camera);
    intercom.url = 'rtsp://hub.example:8554/Preview_04_main';
    return {
        intercom, camera, connections, sends,
        get audio() { return audio; },
        get teardowns() { return teardowns; },
    };
}

function childCameraFixture(options) {
    const fixture = intercomFixture(options);
    const camera = Object.assign(Object.create(ReolinkNvrCamera.prototype), fixture.camera);
    delete camera.addRtspCredentials;
    camera.nvrDevice = {
        storageSettings: { values: { username: 'hub-admin', password: 'p@ss:/?#' } },
    };
    camera.storageSettings = { values: { rtspChannel: 3 } };
    camera.onvifClient = profileClient([
        ['first', 'rtsp://hub.example:8554/Preview_01_main'],
        ['doorbell', 'rtsp://hub.example:8554/h264Preview_04_main'],
    ]);
    camera.onvifIntercom = fixture.intercom;
    fixture.intercom.camera = camera;
    fixture.camera = camera;
    return fixture;
}

test('child-camera startIntercom authenticates with Hub credentials on its own channel', async () => {
    const fixture = childCameraFixture();
    await fixture.camera.startIntercom({});
    const url = new URL(fixture.connections[0]);
    assert.equal(url.username, 'hub-admin');
    assert.equal(decodeURIComponent(url.password), 'p@ss:/?#');
    assert.equal(url.pathname, '/h264Preview_04_main');
    await fixture.camera.stopIntercom();
});

test('child-camera ONVIF connection defaults an unset API port and preserves an override', () => {
    for (const [httpPort, expectedPort] of [[undefined, 80], [8000, 8000]]) {
        const fixture = childCameraFixture();
        Object.assign(fixture.camera.nvrDevice.storageSettings.values, {
            ipAddress: 'hub.example',
            httpPort,
        });
        const [address, username, password] = fixture.camera.createOnvifClient();
        assert.equal(address, `hub.example:${expectedPort}`);
        assert.equal(username, 'hub-admin');
        assert.equal(password, 'p@ss:/?#');
    }
});

test('child-camera startIntercom refuses unmatched profiles before opening RTSP', async () => {
    const fixture = childCameraFixture();
    fixture.camera.storageSettings.values.rtspChannel = 4;
    await assert.rejects(fixture.camera.startIntercom({}), /ONVIF main stream not found/);
    assert.equal(fixture.connections.length, 0);
});

test('child-camera startIntercom reselects its channel and uses updated Hub credentials', async () => {
    const fixture = childCameraFixture();
    await fixture.camera.startIntercom({});
    fixture.camera.storageSettings.values.rtspChannel = 0;
    fixture.camera.nvrDevice.storageSettings.values.password = 'changed';
    await fixture.camera.startIntercom({});
    const url = new URL(fixture.connections[1]);
    assert.equal(url.pathname, '/Preview_01_main');
    assert.equal(url.password, 'changed');
    await fixture.camera.stopIntercom();
});

test('preserves standalone credentials including special characters and an empty password', async () => {
    for (const password of ['', 'p@ss:/?#']) {
        const fixture = intercomFixture();
        fixture.camera.addRtspCredentials = rtsp.RtspCamera.prototype.addRtspCredentials;
        fixture.camera.storage = { getItem: key => key === 'username' ? 'admin' : password };
        await fixture.intercom.checkIntercom();
        const url = new URL(fixture.connections[0]);
        assert.equal(url.username, 'admin');
        assert.equal(decodeURIComponent(url.password), password);
        if (!password)
            assert.equal(fixture.connections[0], 'rtsp://admin:@hub.example:8554/Preview_04_main');
    }
});

test('fails explicitly when the selected stream has no audio backchannel', async () => {
    const fixture = childCameraFixture({ backchannel: false });
    await assert.rejects(fixture.camera.startIntercom({}), /ONVIF audio backchannel not found/);
    await fixture.camera.stopIntercom();
});

function packet(timestamp) {
    return {
        header: { timestamp },
        payload: Buffer.from('audio'),
        serialize() { return this.payload; },
    };
}

test('sends outgoing UDP audio to the selected stream host and stops the session', async () => {
    const fixture = intercomFixture();
    await fixture.intercom.startIntercom({});
    fixture.audio.onRtp(packet(0));
    fixture.audio.onRtp(packet(1600));
    assert.equal(fixture.sends.length, 1);
    assert.equal(fixture.sends[0].ip, 'hub.example');
    assert.equal(fixture.sends[0].port, 20000);
    await fixture.intercom.stopIntercom();
    assert.equal(fixture.teardowns, 1);
    assert.equal(fixture.intercom.intercomClient, undefined);
});

test('falls back to TCP when UDP backchannel setup is rejected', async () => {
    const fixture = intercomFixture({ udpFails: true });
    await fixture.intercom.startIntercom({});
    fixture.audio.onRtp(packet(0));
    fixture.audio.onRtp(packet(1600));
    assert.equal(fixture.sends.length, 1);
    assert.equal(fixture.sends[0].channel, 0);
    await fixture.intercom.stopIntercom();
    assert.equal(fixture.teardowns, 1);
});
