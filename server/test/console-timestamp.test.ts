// Run with: npx tsx --test test/console-timestamp.test.ts
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { ConsoleTimestampTransform } from '../src/plugin/console-timestamp';
import { createConsoleServer } from '../src/plugin/plugin-console';

const time = '2026-01-02T03:04:05.678Z';
const prefix = `[${time}] `;

test('timestamps every line, preserving blank lines, CRLF, and UTF-8 split across writes', t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(time) });
    const stream = new ConsoleTimestampTransform();
    const chunks: Buffer[] = [];
    stream.on('data', data => chunks.push(data));

    const message = Buffer.from('first\n\n雪\r\nlast');
    // Splits both the multi-byte character and the CRLF delimiter.
    for (const byte of message)
        stream.write(Buffer.from([byte]));
    stream.end();

    assert.equal(Buffer.concat(chunks).toString(), `${prefix}first\n${prefix}\n${prefix}雪\r\n${prefix}last`);
});

test('emits partial lines immediately, timestamps only new lines, and ignores empty writes', t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(time) });
    const stream = new ConsoleTimestampTransform();
    const chunks: Buffer[] = [];
    stream.on('data', data => chunks.push(data));
    stream.write('recording');
    assert.equal(Buffer.concat(chunks).toString(), `${prefix}recording`);

    t.mock.timers.tick(25);
    stream.write(' started\nfragment sent\n');
    stream.write('');
    stream.end();
    assert.equal(Buffer.concat(chunks).toString(), `${prefix}recording started\n[2026-01-02T03:04:05.703Z] fragment sent\n`);
});

test('buffered and live plugin/device consoles contain the same timestamps', { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(time) });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = await createConsoleServer(stdout, stderr, 'console header\n');
    t.after(() => {
        stdout.destroy();
        stderr.destroy();
        server.destroy();
    });

    stdout.write('motion\n');
    stderr.write('warning\n');
    assert.equal(server.read(undefined).toString(), `console header\n${prefix}motion\n${prefix}warning\n`);

    const reader = net.connect(server.readPort, '127.0.0.1');
    t.after(() => reader.destroy());
    const chunks: Buffer[] = [];
    reader.on('data', data => chunks.push(data));
    reader.write('undefined');
    await once(reader, 'data');
    assert.equal(Buffer.concat(chunks).toString(), server.read(undefined).toString());

    const next = once(reader, 'data');
    server.pluginConsole.log('first fragment\nsecond fragment');
    await next;
    assert.equal(Buffer.concat(chunks).toString(), server.read(undefined).toString());
    assert.match(server.read(undefined).toString(), /\[2026-01-02T03:04:05.678Z\] first fragment\n\[2026-01-02T03:04:05.678Z\] second fragment\n$/);

    const writer = net.connect(server.writePort, '127.0.0.1');
    t.after(() => writer.destroy());
    writer.write('camera\nmixin recording started\n');
    while (!server.read('camera').length)
        await new Promise<void>(resolve => setImmediate(resolve));

    const deviceReader = net.connect(server.readPort, '127.0.0.1');
    t.after(() => deviceReader.destroy());
    deviceReader.write('camera');
    const [deviceData] = await once(deviceReader, 'data');
    assert.equal(deviceData.toString(), `console header\n${prefix}mixin recording started\n`);
    assert.equal(server.read('camera').toString(), `console header\n${prefix}mixin recording started\n`);

    server.clear('camera');
    assert.equal(server.read('camera').toString(), 'console header\n');
    const deviceNext = once(deviceReader, 'data');
    writer.write('next recording\n');
    await deviceNext;
    assert.equal(server.read('camera').toString(), `console header\n${prefix}next recording\n`);
});
