// Run with: npx ts-node --transpile-only test/rtsp-source-lifecycle.ts
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { Duplex, PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { createRtspSourceLifecycle } from '../src/rtsp-source-lifecycle';

const packet = Buffer.from([0x80, 0x60, 0, 1]);

function fixture(clientPromise: Promise<Duplex> = Promise.resolve(new PassThrough())) {
    let cleanups = 0;
    const warnings: unknown[][] = [];
    const lifecycle = createRtspSourceLifecycle(clientPromise, () => cleanups++, {
        warn: (...args: unknown[]) => warnings.push(args),
    });
    return { ...lifecycle, warnings, clientPromise, cleanups: () => cleanups };
}

test('forwards audio/video RTP and RTCP without treating backpressure as closure', async () => {
    const source = fixture();
    await setImmediate();
    const sent: unknown[][] = [];
    const server = { sendTrack: (...args: unknown[]) => { sent.push(args); return false; } };
    for (const track of ['audio', 'video']) {
        for (const rtcp of [false, true])
            assert.equal(source.sendTrack(server, track, packet, rtcp), false);
    }
    assert.deepEqual(sent, [
        ['audio', packet, false], ['audio', packet, true],
        ['video', packet, false], ['video', packet, true],
    ]);
    assert.equal(source.cleanups(), 0);
    source.cleanup();
});

test('stops once on end, close and a late socket error; no later track writes', async () => {
    const source = fixture();
    const client = await source.clientPromise;
    let writes = 0;
    const server = { sendTrack: () => writes++ };
    client.emit('end');
    client.emit('close');
    client.emit('error', Object.assign(new Error('late write'), { code: 'EPIPE' }));
    source.cleanup();
    for (const track of ['audio', 'video'])
        for (const rtcp of [false, true]) source.sendTrack(server, track, packet, rtcp);
    await setImmediate();
    assert.equal(source.cleanups(), 1);
    assert.equal(client.destroyed, true);
    assert.equal(writes, 0);
    assert.equal(source.warnings.length, 0);
});

test('destroys a client that connects after cleanup without resuming forwarding', async () => {
    let connected: (client: PassThrough) => void;
    const source = fixture(new Promise(resolve => connected = resolve));
    source.cleanup();
    const client = new PassThrough();
    connected(client);
    await setImmediate();
    assert.equal(client.destroyed, true);
    assert.equal(source.cleanups(), 1);
    assert.equal(source.sendTrack({ sendTrack: () => assert.fail('write after cleanup') }, 'video', packet, false), undefined);
});

test('handles a rejected client promise without an unhandled rejection', async () => {
    const source = fixture(Promise.reject(new Error('client unavailable')));
    await setImmediate();
    assert.equal(source.cleanups(), 1);
});

test('does not forward to a socket whose writable side has ended', async () => {
    const source = fixture();
    const client = await source.clientPromise;
    client.end();
    source.sendTrack({ sendTrack: () => assert.fail('write after end') }, 'video', packet, false);
    assert.equal(source.cleanups(), 1);
});

test('handles an asynchronous EPIPE from an actual stream write', { timeout: 5000 }, async () => {
    const client = new Duplex({
        read() { },
        write(_packet, _encoding, callback) {
            setImmediate().then(() => callback(Object.assign(new Error('write failure'), { code: 'EPIPE' })));
        },
    });
    const source = fixture(Promise.resolve(client));
    await setImmediate();
    const closed = new Promise(resolve => client.once('close', resolve));
    source.sendTrack({ sendTrack: () => client.write(packet) }, 'video', packet, false);
    await closed;
    assert.equal(source.cleanups(), 1);
    assert.equal(source.warnings.length, 0);
});

test('rejects writes immediately after destroy, before the close event', async () => {
    const source = fixture();
    const client = await source.clientPromise;
    client.destroy();
    source.sendTrack({ sendTrack: () => assert.fail('write to destroyed socket') }, 'video', packet, false);
    assert.equal(source.cleanups(), 1);
});

test('cleans up a socket that was already closed when the promise resolved', async () => {
    const client = new PassThrough();
    client.destroy();
    const source = fixture(Promise.resolve(client));
    await setImmediate();
    assert.equal(source.cleanups(), 1);
});

test('stops forwarding after synchronous write failure', async () => {
    const source = fixture();
    await setImmediate();
    let writes = 0;
    const server = { sendTrack: () => { writes++; throw Object.assign(new Error('write failure'), { code: 'ECONNRESET' }); } };
    source.sendTrack(server, 'video', packet, false);
    source.sendTrack(server, 'audio', packet, true);
    assert.equal(source.cleanups(), 1);
    assert.equal(writes, 1);
    assert.equal(source.warnings.length, 0);
});

test('retains diagnostics for unexpected synchronous and asynchronous failures', async () => {
    const source = fixture();
    const client = await source.clientPromise;
    const error = Object.assign(new Error('unexpected failure'), { code: 'EIO' });
    source.sendTrack({ sendTrack: () => { throw error; } }, 'video', packet, false);
    client.emit('error', error);
    assert.equal(source.cleanups(), 1);
    assert.equal(source.warnings.length, 2);
    assert.equal(source.warnings[0][1], error);
    assert.equal(source.warnings[1][1], error);
});

test('cleans up a real TCP connection on peer FIN even with allowHalfOpen', { timeout: 5000 }, async t => {
    const listener = net.createServer({ allowHalfOpen: true });
    let peer: net.Socket, client: net.Socket;
    t.after(() => { peer?.destroy(); client?.destroy(); listener.close(); });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const accepted = once(listener, 'connection');
    peer = net.connect((listener.address() as net.AddressInfo).port, '127.0.0.1');
    [client] = await accepted as [net.Socket];
    client.resume();
    const source = fixture(Promise.resolve(client));
    await setImmediate();
    const ended = once(client, 'end');
    const closed = once(client, 'close');
    peer.end();
    await ended;
    await closed;
    assert.equal(source.cleanups(), 1);
    assert.equal(client.destroyed, true);
    source.sendTrack({ sendTrack: () => assert.fail('write after peer FIN') }, 'video', packet, false);
});

test('cleans up a real TCP connection on peer reset', { timeout: 5000 }, async t => {
    const listener = net.createServer();
    let peer: net.Socket, client: net.Socket;
    t.after(() => { peer?.destroy(); client?.destroy(); listener.close(); });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const accepted = once(listener, 'connection');
    peer = net.connect((listener.address() as net.AddressInfo).port, '127.0.0.1');
    [client] = await accepted as [net.Socket];
    client.resume();
    const source = fixture(Promise.resolve(client));
    await setImmediate();
    const closed = new Promise(resolve => client.once('close', resolve));
    peer.resetAndDestroy();
    await closed;
    assert.equal(source.cleanups(), 1);
    assert.equal(source.warnings.length, 0);
});
