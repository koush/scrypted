// Run: node --test test/stream-destinations.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the actual mixin method without starting the plugin, SDK, or FFmpeg.
// Its class is not exported and importing main.ts starts the plugin runtime.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {');
const end = source.indexOf('\n  async release()', start);
assert.ok(start >= 0 && end > start, 'locate the production method');
const code = stripTypeScriptTypes('({' + source.slice(start, end) + '})');
const { getVideoStreamOptions } = runInNewContext(code, { prebufferDurationMs: 5000 });

function fixture(remoteRecording = 'recording') {
    const streams = [{ id: 'local' }, { id: 'remote' }, { id: 'recording' }, { id: 'low' }];
    const choose = id => () => ({ stream: streams.find(s => s.id === id) });
    return {
        streams,
        mixinDevice: { async getVideoStreamOptions() { return streams; } },
        sessions: new Map(),
        getPrebufferedStreams() { return []; },
        streamSettings: {
            getDefaultStream: choose('local'),
            getRemoteStream: choose('remote'),
            getRemoteRecordingStream: choose(remoteRecording),
            getRecordingStream: choose('recording'),
            getLowResolutionStream: choose('low'),
        },
    };
}

test('medium-resolution advertises remote viewing rather than remote recording', async () => {
    const context = fixture();
    await getVideoStreamOptions.call(context);
    assert.ok(context.streams[1].destinations.includes('remote'));
    assert.ok(context.streams[1].destinations.includes('medium-resolution'));
    assert.ok(context.streams[2].destinations.includes('remote-recorder'));
    assert.ok(!context.streams[2].destinations.includes('medium-resolution'));
});

test('a shared remote/recording source keeps both destinations', async () => {
    const context = fixture('remote');
    await getVideoStreamOptions.call(context);
    for (const destination of ['remote', 'medium-resolution', 'remote-recorder'])
        assert.ok(context.streams[1].destinations.includes(destination));
    assert.ok(context.streams[0].destinations.includes('local'));
    assert.ok(context.streams[3].destinations.includes('low-resolution'));
});

test('provider-supplied destinations and prebuffer metadata are preserved', async () => {
    const context = fixture();
    context.streams[1].destinations = ['remote'];
    context.getPrebufferedStreams = () => [context.streams[0]];
    await getVideoStreamOptions.call(context);
    assert.deepEqual(context.streams[1].destinations, ['remote']);
    assert.equal(context.streams[0].prebuffer, 5000);
});
