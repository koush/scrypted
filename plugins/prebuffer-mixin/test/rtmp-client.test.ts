// Run with: npx tsx --test test/rtmp-client.test.ts
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { test, TestContext } from 'node:test';
import { RtmpClient } from '../src/rtmp-client';

function makeClient(t: TestContext, onConnect: (socket: Socket, connected: () => void) => void) {
  const client = new RtmpClient('rtmp://example.invalid/live/test');
  const socket = client.socket!;
  // Keep the real socket's close/error behavior, without opening a connection.
  socket.connect = ((_port: number, _host: string, connected: () => void) => {
    onConnect(socket, connected);
    return socket;
  }) as Socket['connect'];
  t.after(() => socket.destroy());
  return { client, socket };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('RTMP setup remained pending')), 1000);
      }),
    ]);
  }
  finally {
    clearTimeout(timeout);
  }
}

test('setup rejects when a still-connecting socket closes without an error', async t => {
  const { client, socket } = makeClient(t, socket => {
    // startRtmpSession's activity timeout destroys the socket without an error.
    setImmediate(() => socket.destroy());
  });
  await assert.rejects(bounded(client.setup()), /RTMP socket closed before connection completed/);
  assert.equal(socket.destroyed, true);
  // The permanent diagnostic listeners remain; temporary connect listeners go.
  assert.equal(socket.listenerCount('close'), 1);
  assert.equal(socket.listenerCount('error'), 1);
});

test('successful connection starts the handshake and removes temporary listeners', async t => {
  const { client, socket } = makeClient(t, (_socket, connected) => queueMicrotask(connected));
  let handshakes = 0;
  (client as any).performHandshake = async () => { handshakes++; };
  await bounded((client as any).connect());
  assert.equal(handshakes, 1);
  assert.equal(socket.listenerCount('close'), 1);
  assert.equal(socket.listenerCount('error'), 1);
});

test('connection errors preserve the original error and remove temporary listeners', async t => {
  const failure = new Error('ECONNREFUSED');
  const { client, socket } = makeClient(t, socket => {
    queueMicrotask(() => socket.emit('error', failure));
  });
  await assert.rejects(bounded(client.setup()), error => error === failure);
  assert.equal(socket.listenerCount('close'), 1);
  assert.equal(socket.listenerCount('error'), 1);
});

test('closing the socket during the handshake still rejects setup', async t => {
  const { client, socket } = makeClient(t, (_socket, connected) => queueMicrotask(connected));
  socket.write = (() => {
    queueMicrotask(() => socket.destroy());
    return true;
  }) as Socket['write'];
  await assert.rejects(bounded(client.setup()), /stream ended/);
});
