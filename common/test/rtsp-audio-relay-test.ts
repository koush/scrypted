// Run with ts-node --transpile-only common/test/rtsp-audio-relay-test.ts.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { RtspAudioRelay, MAX_RTSP_AUDIO_BUFFER } from '../src/rtsp-audio-relay';
import { RtspServer } from '../src/rtsp-server';

const deadline = <T>(promise: Promise<T>) => {
    let timer: NodeJS.Timeout;
    return Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RTSP test timed out')), 5000);
    })]).finally(() => clearTimeout(timer));
};

test('services keepalives after PLAY, including more than a socket read buffer', async () => {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const connected = once(listener, 'connection');
    const client = net.connect((listener.address() as net.AddressInfo).port, '127.0.0.1');
    const [serverSocket] = await connected;
    let closed = 0;
    const relay = new RtspAudioRelay(new RtspServer(serverSocket), () => closed++);
    const running = relay.start();
    // Attach a rejection handler immediately; cleanup may close a pending read.
    running.catch(() => {});
    let received = '';
    client.on('data', data => received += data.toString());
    const request = async (method: string, sequence: number) => {
        received = '';
        client.write(`${method} rtsp://127.0.0.1/audio RTSP/1.0\r\nCSeq: ${sequence}\r\n\r\n`);
        await deadline((async () => {
            while (!received.includes('\r\n\r\n'))
                await once(client, 'data');
        })());
        assert.match(received, /^RTSP\/1.0 200 OK/);
        assert.match(received, new RegExp(`CSeq: ${sequence}\\r\\n`));
    };
    try {
        await request('PLAY', 1);
        for (let i = 2; i < 1600; i++)
            await request(i % 2 ? 'OPTIONS' : 'GET_PARAMETER', i);
        await request('TEARDOWN', 1600);
        await deadline(running);
        assert.equal(closed, 1);
        assert.equal(serverSocket.destroyed, true);
        relay.close();
        assert.equal(closed, 1);
    }
    finally {
        relay.close();
        client.destroy();
        listener.close();
        await running.catch(() => {});
    }
});

test('bounds a stalled consumer and closes the session exactly once', async () => {
    const socket = new PassThrough({ highWaterMark: 16 });
    let finish: () => void;
    let sent = 0;
    let closed = 0;
    const server = {
        client: socket,
        handlePlayback: async () => 'play',
        handleSetup: () => new Promise<string>(resolve => finish = () => resolve('teardown')),
        sendTrack: () => { sent++; socket.write(Buffer.alloc(65536)); },
        destroy: () => { socket.destroy(); finish?.(); },
    } as unknown as RtspServer;
    const relay = new RtspAudioRelay(server, () => closed++);
    relay.sendTrack('audio', Buffer.alloc(1), false);
    assert.equal(sent, 0); // No packet delivery until PLAY.
    const running = relay.start();
    await Promise.resolve();
    for (let i = 0; i < 100; i++)
        relay.sendTrack('audio', Buffer.alloc(1), false);
    await deadline(running);
    assert.ok(sent > 0 && sent <= MAX_RTSP_AUDIO_BUFFER / 65536 + 1);
    assert.equal(socket.destroyed, true);
    assert.equal(closed, 1);
    const previous = sent;
    relay.sendTrack('audio', Buffer.alloc(1), false);
    assert.equal(sent, previous);
});

test('handshake errors and external close release the relay', async () => {
    const socket = new PassThrough();
    let closed = 0;
    const failure = new Error('handshake failed');
    const relay = new RtspAudioRelay({
        client: socket,
        handlePlayback: async () => { throw failure; },
        destroy: () => socket.destroy(),
    } as unknown as RtspServer, () => closed++);
    await assert.rejects(relay.start(), failure);
    assert.equal(closed, 1);
    assert.equal(socket.destroyed, true);
    relay.close();
    assert.equal(closed, 1);
});
