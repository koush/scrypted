// Run with Node 22.15+:
// node --experimental-strip-types --test test/camera-webrtc-startup.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

// Resolve the monorepo's source aliases without building plugin/native dependencies.
registerHooks({ resolve(specifier, context, next) {
    const prefix = '@scrypted/common/src/';
    if (specifier.startsWith(prefix))
        return { url: new URL('../../../common/src/' + specifier.slice(prefix.length) + '.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === './deferred' && context.parentURL?.endsWith('/common/src/async-queue.ts'))
        return { url: new URL('./deferred.ts', context.parentURL).href, shortCircuit: true };
    return next(specifier, context);
} });
const { createHomeKitWebRTCDelegate } = await import('../src/types/camera/camera-webrtc.ts');
const offer = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 100\r\na=mid:0\r\na=rtpmap:100 H265/90000\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=rtpmap:111 opus/48000/2\r\n';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(setPlayback) {
    const calls = { ended: 0, keys: [], warnings: [], remote: [] };
    const control = {
        setPlayback,
        async endSession() { calls.ended++; },
        async updateSFrameReceiveKeys(update) { calls.keys.push(update); },
        async setRemoteDescription(description) { calls.remote.push(description); },
        async createLocalDescription() { return { type: 'answer', sdp: 'answer' }; },
    };
    const camera = { async startRTCSignalingSession(signaling) {
        await signaling.setRemoteDescription({ type: 'offer', sdp: offer });
        return control;
    } };
    const log = { log() {}, warn(...args) { calls.warnings.push(args); } };
    const delegate = createHomeKitWebRTCDelegate(camera, log, { width: 1920, height: 1080, frameRate: 20, peakBitrate: 2000 });
    return { delegate, calls };
}
const request = { sessionIdentifier: 'test', options: { sframeEnabled: false } };
async function within(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('blocked on playback hint')), 300); })]); }
    finally { clearTimeout(timer); }
}

test('reoffer can complete while the optional playback hint is pending', async t => {
    const hint = deferred(); const { delegate, calls } = fixture(() => hint.promise);
    t.after(async () => { hint.resolve(); await delegate.handleEndSession('test'); });
    const result = await delegate.handleSolicitOffer(request);
    assert.match(result.sdpOffer, /H265\/90000/);
    assert.equal(result.sframe.key.length, 32);
    await tick();
    assert.deepEqual(await within(delegate.handleReoffer({ sessionIdentifier: 'test', sdpOffer: 'reoffer' })), { sdpAnswer: 'answer' });
    assert.deepEqual(calls.remote, [{ type: 'offer', sdp: 'reoffer' }]);
});

test('receive keys are forwarded even when a playback hint has not completed', async t => {
    const hint = deferred(); const { delegate, calls } = fixture(() => hint.promise);
    t.after(async () => { hint.resolve(); await delegate.handleEndSession('test'); });
    await delegate.handleSolicitOffer(request);
    await delegate.handleUpdateSession({ sessionIdentifier: 'test', receiveKeysToAdd: [{ kid: 1n, key: Buffer.alloc(32, 7) }], receiveKIDsToRemove: [] });
    await tick(); await tick();
    assert.equal(calls.keys.length, 1);
    assert.equal(calls.keys[0].add[0].kid, '1');
});

test('rejected optional hints do not terminate a negotiated session', async t => {
    const { delegate, calls } = fixture(async () => { throw new Error('hint unsupported'); });
    t.after(() => delegate.handleEndSession('test'));
    await delegate.handleSolicitOffer(request); await tick(); await tick();
    assert.equal(calls.ended, 0);
    assert.equal((await delegate.handleReoffer({ sessionIdentifier: 'test', sdpOffer: 'reoffer' })).sdpAnswer, 'answer');
    assert.ok(calls.warnings.length > 0);
});

test('unknown or ended reoffer gets an explicit session-control error', async () => {
    const { delegate } = fixture(async () => {});
    await assert.rejects(delegate.handleReoffer({ sessionIdentifier: 'missing', sdpOffer: 'reoffer' }), /session control is not ready/);
});

test('session end still closes the underlying control exactly once', async () => {
    const { delegate, calls } = fixture(async () => {});
    await delegate.handleSolicitOffer(request); await tick();
    await delegate.handleEndSession('test'); await delegate.handleEndSession('test');
    assert.equal(calls.ended, 1);
});
