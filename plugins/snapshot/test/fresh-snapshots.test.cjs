// Run from the repository root: node --test plugins/snapshot/test/fresh-snapshots.test.cjs
// Compile the actual plugin sources, substituting only host/media boundaries.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../../sdk/node_modules/typescript');
const root = path.resolve(__dirname, '../../..');
const quiet = { log() {}, warn() {}, error() {}, debug() {} };
function load(file, mocks = {}, globals = {}) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
        fileName: file,
    }).outputText;
    vm.runInNewContext(source, {
        exports, Buffer, console: quiet, process, setTimeout: (fn, ms) => {
            const timer = setTimeout(fn, ms);
            if (ms >= 4000) timer.unref();
            return timer;
        }, clearTimeout,
        require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
        ...globals,
    }, { filename: file });
    return exports;
}
const promises = load('common/src/promise-utils.ts');
function fixture({ now } = {}) {
    let sourceCalls = 0, errorImages = 0, streamRequest;
    const image = Buffer.from('fresh image');
    const mediaManager = {
        convertMediaObjectToBuffer: async value => value,
        convertMediaObjectToJSON: async () => ({ inputArguments: [] }),
        getFFmpegPath: async () => 'ffmpeg',
    };
    const channel = { id: 'main', prebuffer: 6000 };
    const realDevice = {
        sleeping: false,
        getVideoStreamOptions: async () => [channel],
        getVideoStream: async request => { streamRequest = request; return image; },
    };
    const sdk = { mediaManager, systemManager: { getDeviceById: () => realDevice } };
    const filters = { ffmpegFilterImage: async () => image, ffmpegFilterImageBuffer: async value => value };
    const { SnapshotMixin } = load('plugins/snapshot/src/main.ts', {
        '@scrypted/common/src/autoenable-mixin-provider': { AutoenableMixinProvider: class {} },
        '@scrypted/common/src/http-auth-fetch': {},
        '@scrypted/common/src/promise-utils': promises,
        '@scrypted/common/src/settings-mixin': { SettingsMixinDeviceBase: class {} },
        '@scrypted/sdk': { __esModule: true, default: sdk, ScryptedInterface: { Camera: 'Camera', Sleep: 'Sleep', Settings: 'Settings' }, ScryptedMimeTypes: { FFmpegInput: 'x-scrypted/x-ffmpeg-input' } },
        '@scrypted/sdk/acl': {},
        '@scrypted/sdk/storage-settings': { StorageSettings: class {} },
        '../../objectdetector/src/polygon': {},
        './ffmpeg-image-filter': filters,
        './image-converter': {}, './image-reader': { loadSharp: () => false }, './image-writer': {},
    }, now === undefined ? {} : { Date: class extends Date { static now() { return now; } } });
    const camera = Object.create(SnapshotMixin.prototype);
    Object.assign(camera, {
        id: 'camera', console: quiet, plugin: {}, mixinDeviceInterfaces: ['Camera'],
        storageSettings: { values: { defaultSnapshotChannel: 'Camera Default', snapshotsFromPrebuffer: 'Disabled' } },
        snapshotDebouncer: promises.createMapPromiseDebouncer(), currentPictureTime: 0,
        cropAndScale: async value => value,
        createErrorImage: async () => { errorImages++; return Buffer.from('error image'); },
        getPictureOptions: async () => [],
        mixinDevice: { takePicture: async () => { sourceCalls++; return image; } },
    });
    return { camera, realDevice, channel, filters, image, sdk,
        sourceCalls: () => sourceCalls, errorImages: () => errorImages, streamRequest: () => streamRequest };
}
const fresh = { reason: 'periodic', requireFresh: true };
function prime(camera) {
    camera.currentPicture = Buffer.from('old image');
    camera.lastAvailablePicture = camera.currentPicture;
    camera.currentPictureTime = Date.now();
}

test('fresh snapshots share an in-progress capture, then capture again after completion', async () => {
    const f = fixture();
    let calls = 0, resolve;
    f.camera.takePictureInternal = () => { calls++; return new Promise(r => resolve = r); };
    const first = f.camera.takePictureRaw(fresh), second = f.camera.takePictureRaw(fresh);
    assert.equal(calls, 1);
    resolve(f.image);
    assert.deepEqual(await Promise.all([first, second]), [f.image, f.image]);
    const third = f.camera.takePictureRaw(fresh);
    assert.equal(calls, 2);
    resolve(Buffer.from('new image'));
    assert.equal((await third).toString(), 'new image');
});

test('strict request does not join a legacy completed-image cache', async () => {
    const f = fixture();
    await f.camera.takePictureRaw({ reason: 'periodic' });
    await f.camera.takePictureRaw(fresh);
    assert.equal(f.sourceCalls(), 2);
});

test('strict capture failure rejects despite a recent cached image', async () => {
    const f = fixture(); prime(f.camera);
    const error = new Error('offline');
    f.camera.mixinDevice.takePicture = async () => { throw error; };
    await assert.rejects(f.camera.takePictureRaw(fresh), e => e === error);
    assert.equal(f.errorImages(), 0);
});

test('strict failure without a cache does not generate an error JPEG', async () => {
    const f = fixture();
    f.camera.mixinDevice.takePicture = async () => { throw new Error('offline'); };
    await assert.rejects(f.camera.takePictureRaw(fresh), /offline/);
    assert.equal(f.errorImages(), 0);
});

test('strict timeout rejects instead of using cache and later requests recover', async () => {
    const f = fixture(); prime(f.camera);
    let finish;
    f.camera.takePictureInternal = () => new Promise(resolve => finish = resolve);
    await assert.rejects(f.camera.takePictureRaw({ ...fresh, timeout: 5 }), /Timed Out/);
    assert.equal(f.errorImages(), 0);
    finish(f.image);
    await new Promise(resolve => setImmediate(resolve));
    f.camera.takePictureInternal = async () => Buffer.from('recovered');
    assert.equal((await f.camera.takePictureRaw(fresh)).toString(), 'recovered');
});

test('strict image-processing failure is propagated', async () => {
    const f = fixture();
    f.filters.ffmpegFilterImageBuffer = async () => { throw new Error('resize failed'); };
    await assert.rejects(f.camera.takePictureRaw({ ...fresh, picture: { width: 640 } }), /resize failed/);
    assert.equal(f.errorImages(), 0);
});

test('strict resize is not reused when acquisition timestamps collide', async () => {
    const f = fixture({ now: 1234 });
    let resized = 0;
    f.filters.ffmpegFilterImageBuffer = async () => Buffer.from(`resized-${++resized}`);
    const opts = { ...fresh, picture: { width: 640 } };
    assert.equal((await f.camera.takePictureRaw(opts)).toString(), 'resized-1');
    assert.equal((await f.camera.takePictureRaw(opts)).toString(), 'resized-2');
});

test('legacy cache fallback and generated error images remain available', async () => {
    const f = fixture(); prime(f.camera);
    f.camera.mixinDevice.takePicture = async () => { throw new Error('offline'); };
    assert.equal((await f.camera.takePictureRaw({ reason: 'periodic' })).toString(), 'old image');
    const empty = fixture();
    empty.camera.mixinDevice.takePicture = async () => { throw new Error('offline'); };
    assert.equal((await empty.camera.takePictureRaw({ reason: 'periodic' })).toString(), 'error image');
    assert.equal(empty.errorImages(), 1);
});

test('event snapshot failures still reject without fallback', async () => {
    const f = fixture(); prime(f.camera);
    f.camera.mixinDevice.takePicture = async () => { throw new Error('event failed'); };
    await assert.rejects(f.camera.takePictureRaw({ reason: 'event' }), /event failed/);
});

test('strict snapshots pass the policy to sleeping camera providers instead of returning last image', async () => {
    const f = fixture(); prime(f.camera);
    f.camera.mixinDeviceInterfaces.push('Sleep'); f.realDevice.sleeping = true;
    let options;
    f.camera.mixinDevice.takePicture = async opts => { options = opts; return f.image; };
    assert.equal(await f.camera.takePictureInternal(undefined, false, true), f.image);
    assert.equal(options.requireFresh, true);
    assert.equal((await f.camera.takePictureInternal(undefined, false)).toString(), 'old image');
});

test('strict privacy mode rejects instead of sending a placeholder image', async () => {
    const f = fixture(); f.camera.storageSettings.values.privacyMode = true;
    await assert.rejects(f.camera.takePictureRaw(fresh), /disabled/);
    assert.equal(f.errorImages(), 0);
});

test('strict video snapshots request zero prebuffer and allow stream startup without mutating options', async () => {
    const f = fixture(); prime(f.camera);
    f.camera.storageSettings.values.snapshotsFromPrebuffer = 'Enabled';
    await f.camera.takePictureRaw(fresh);
    assert.equal(f.streamRequest().prebuffer, 0);
    assert.equal(f.streamRequest().refresh, true);
    assert.equal(f.channel.prebuffer, 6000);
    assert.equal(f.channel.refresh, undefined);
});

test('known cached camera snapshots use video or reject when video snapshots are disabled', async () => {
    const f = fixture();
    f.camera.getPictureOptions = async () => [{ staleDuration: 30000 }];
    await assert.rejects(f.camera.takePictureRaw(fresh), /cached/);
    f.camera.storageSettings.values.snapshotsFromPrebuffer = 'Default';
    assert.equal(await f.camera.takePictureRaw(fresh), f.image);
    assert.equal(f.sourceCalls(), 0);
    assert.equal(f.streamRequest().prebuffer, 0);
});

test('HomeKit global policy is read for each request and preserves event reasons and sizes', async () => {
    const f = fixture();
    let requests = [], alerts = 0;
    const plugin = { storageSettings: { values: { requireFreshSnapshots: false } }, snapshotThrottles: new Map(), log: { a: () => alerts++ } };
    const { createSnapshotHandler } = load('plugins/homekit/src/types/camera/camera-snapshot.ts', {
        '@scrypted/common/src/sleep': {}, 'lodash/throttle': {},
        '@scrypted/sdk': { __esModule: true, default: { ...f.sdk, systemManager: { getDeviceByName: () => undefined } }, ScryptedInterface: { Camera: 'Camera' } },
        '../../hap': { ResourceRequestReason: { EVENT: 1 } },
    });
    const device = { id: 'camera', name: 'Camera', interfaces: ['Camera'], takePicture: async opts => { requests.push(opts); return f.image; } };
    const handler = createSnapshotHandler(device, {}, plugin, quiet);
    const request = reason => new Promise(resolve => handler({ reason, width: 640, height: 360 }, (error, image) => resolve({ error, image })));
    assert.equal((await request(0)).image, f.image);
    assert.equal(requests[0].requireFresh, undefined);
    plugin.storageSettings.values.requireFreshSnapshots = true;
    await request(0); await request(1);
    assert.equal(requests[1].requireFresh, true);
    assert.equal(requests[1].reason, 'periodic');
    assert.equal(requests[2].reason, 'event');
    assert.equal(requests[2].picture.width, 640);
    const error = new Error('offline'); device.takePicture = async () => { throw error; };
    const failure = await request(0);
    assert.equal(failure.error, error); assert.equal(failure.image, undefined);
    assert.equal(alerts, 0);
});


test('strict crop failure is propagated without returning an older image', async () => {
    const f = fixture(); prime(f.camera);
    f.camera.cropAndScale = async () => { throw new Error('crop failed'); };
    await assert.rejects(f.camera.takePictureRaw(fresh), /crop failed/);
    assert.equal(f.errorImages(), 0);
});
