import assert from 'assert';
import { once } from 'events';
import net, { AddressInfo } from 'net';
import { PassThrough, Readable } from 'stream';
import { readLength, readLine } from '../src/read-stream';
import { RtspClient, parseHeaders, readMessage } from '../src/rtsp-server';
import { sleep } from '../src/sleep';

// Run with: npx ts-node test/rtsp-read-message.ts

// Captured 2026-09-04 from a Luma x20 (LUM-820-IP-TMHW, firmware 5.1.1.0,
// "Server: Customer RTSP Server/1.0.0") on the RTSP control socket immediately
// after PLAY over RTP/AVP/TCP. It is the complete PLAY response followed by the
// first interleaved frame: channel 3, 56 bytes (an RTCP sender report).
//
// The line between "Session:" and "RTP-Info:" is a single SP then CRLF (20 0d 0a).
// Under RFC 2068 4.2 (which RFC 2326 4.2 defers to) a line starting with SP or HT
// continues the previous header, so this is a content-free fold, not the end of
// the header block. The same bytes were seen on three cameras (two 4K models and
// the 1080p LUM-220) over both TCP and UDP transports.
const LUMA_PLAY_RESPONSE = Buffer.from(
    '525453502f312e3020323030204f4b0d0a5365727665723a20437573746f6d65722052545350205365727665722f312e' +
    '302e300d0a435365713a20360d0a53657373696f6e3a203832313732343435333735393738390d0a200d0a5254502d49' +
    '6e666f3a2075726c3d727473703a2f2f3139322e3136382e322e3233363a3535342f70726f66696c65312f747261636b' +
    '313b7365713d35363335303b72747074696d653d313137333738363434362c75726c3d727473703a2f2f3139322e3136' +
    '382e322e3233363a3535342f70726f66696c65312f747261636b323b7365713d32363336373b72747074696d653d3533' +
    '303538333436310d0a0d0a2403003880c800060cc6c9ed83ad7eeb000014771fa00fa5000000000000000081ca00060c' +
    'c6c9ed011164342d36612d39312d31642d37392d623800',
    'hex');

const EXPECTED_RTP_INFO = 'url=rtsp://192.168.2.236:554/profile1/track1;seq=56350;rtptime=1173786446,url=rtsp://192.168.2.236:554/profile1/track2;seq=26367;rtptime=530583461';

function stream(buffer: Buffer): Readable {
    const pt = new PassThrough();
    pt.end(buffer);
    return pt;
}

// The reader as it was before this change, kept here to demonstrate the failure.
async function readMessageLegacy(client: Readable): Promise<string[]> {
    let currentHeaders: string[] = [];
    while (true) {
        let line = await readLine(client);
        line = line.trim();
        if (!line)
            return currentHeaders;
        currentHeaders.push(line);
    }
}

async function testLegacyReaderStopsEarly() {
    const s = stream(LUMA_PLAY_RESPONSE);
    const message = await readMessageLegacy(s);
    assert.strictEqual(message.length, 4, 'legacy reader stops at the whitespace line');
    assert.strictEqual(parseHeaders(message)['rtp-info'], undefined);
    const next = await readLength(s, 4);
    assert.strictEqual(next.toString(), 'RTP-', 'legacy reader leaves RTP-Info in the buffer, which is what the frame reader then rejects');
}

async function testLumaPlayResponse() {
    const s = stream(LUMA_PLAY_RESPONSE);
    const message = await readMessage(s);
    assert.deepStrictEqual(message, [
        'RTSP/1.0 200 OK',
        'Server: Customer RTSP Server/1.0.0',
        'CSeq: 6',
        'Session: 821724453759789',
        `RTP-Info: ${EXPECTED_RTP_INFO}`,
    ]);
    const headers = parseHeaders(message);
    assert.strictEqual(headers['session'], '821724453759789');
    assert.strictEqual(headers['rtp-info'], EXPECTED_RTP_INFO);

    // the next bytes in the stream must be the interleaved frame header.
    const frameHeader = await readLength(s, 4);
    assert.strictEqual(frameHeader[0], 0x24);
    assert.strictEqual(frameHeader.readUInt8(1), 3);
    assert.strictEqual(frameHeader.readUInt16BE(2), 56);
    const frame = await readLength(s, 56);
    assert.strictEqual(frame.length, 56);
}

async function testPlainMessageUnchanged() {
    const s = stream(Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 2  \r\nContent-Length: 5\r\n\r\nhello'));
    const message = await readMessage(s);
    assert.deepStrictEqual(message, ['RTSP/1.0 200 OK', 'CSeq: 2', 'Content-Length: 5']);
    const body = await readLength(s, 5);
    assert.strictEqual(body.toString(), 'hello');
}

async function testBareLfUnchanged() {
    const s = stream(Buffer.from('RTSP/1.0 200 OK\nCSeq: 3\n\n$'));
    const message = await readMessage(s);
    assert.deepStrictEqual(message, ['RTSP/1.0 200 OK', 'CSeq: 3']);
    assert.strictEqual((await readLength(s, 1)).toString(), '$');
}

async function testFoldedHeader() {
    const s = stream(Buffer.from('RTSP/1.0 200 OK\r\nRTP-Info: url=a;seq=1;rtptime=2,\r\n url=b;seq=3;rtptime=4\r\n\t url=c;seq=5\r\nCSeq: 4\r\n\r\n'));
    const message = await readMessage(s);
    assert.deepStrictEqual(message, [
        'RTSP/1.0 200 OK',
        'RTP-Info: url=a;seq=1;rtptime=2, url=b;seq=3;rtptime=4 url=c;seq=5',
        'CSeq: 4',
    ]);
}

async function testWhitespaceOnlyLinesDoNotTerminate() {
    const s = stream(Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 5\r\n \r\n\t\r\n   \t \r\nSession: 1\r\n\r\n'));
    const message = await readMessage(s);
    assert.deepStrictEqual(message, ['RTSP/1.0 200 OK', 'CSeq: 5', 'Session: 1']);
}

async function testFirstLineNotFolded() {
    // a leading space on the very first line has nothing to fold into: keep the old behavior of trimming it.
    const s = stream(Buffer.from(' RTSP/1.0 200 OK\r\nCSeq: 6\r\n\r\n'));
    const message = await readMessage(s);
    assert.deepStrictEqual(message, ['RTSP/1.0 200 OK', 'CSeq: 6']);
}

async function testRawLineLogging() {
    const logged: string[] = [];
    const console = { log: (...args: any[]) => logged.push(args.join(' ')) } as unknown as Console;
    const s = stream(Buffer.from('RTSP/1.0 200 OK\r\n \r\n\r\n'));
    await readMessage(s, console);
    assert.strictEqual(logged.length, 3);
    assert.strictEqual(logged[1], 'rtsp raw line " \\r" -> "" [200d]');
}

async function withServer(payload: Buffer, test: (client: RtspClient) => Promise<void>) {
    const server = net.createServer(socket => {
        socket.write(payload);
        socket.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const client = new RtspClient(`rtsp://127.0.0.1:${port}/profile1`);
    try {
        await once(client.client, 'connect');
        // let the whole payload land in the socket buffer before reading, so the
        // bad header dump below is deterministic.
        await sleep(50);
        await test(client);
    }
    finally {
        client.client.destroy();
        server.close();
    }
}

async function testRtspClientReadLoop() {
    await withServer(LUMA_PLAY_RESPONSE, async client => {
        // this is what RtspClient.play() does: the RTSP-aware message read.
        const message = await client.readMessage();
        assert.strictEqual(parseHeaders(message)['rtp-info'], EXPECTED_RTP_INFO);

        // then rtsp-session.ts hands the socket to readLoop, which failed here before.
        const received: { channel: number, length: number }[] = [];
        client.setupOptions.set(3, {
            type: 'tcp',
            port: 3,
            onRtp: (header, data) => received.push({ channel: header.readUInt8(1), length: data.length }),
        });
        await client.readLoop();
        assert.deepStrictEqual(received, [{ channel: 3, length: 56 }]);
    });
}

async function testBadHeaderErrorIncludesContext() {
    // the bytes the old reader left behind: everything from RTP-Info onwards.
    const leftover = LUMA_PLAY_RESPONSE.subarray(LUMA_PLAY_RESPONSE.indexOf('RTP-Info'));
    await withServer(leftover, async client => {
        await assert.rejects(client.readMessage(), (e: Error) => {
            assert.match(e.message, /invalid frame magic/);
            assert.match(e.message, /: RTP-\n/);
            assert.match(e.message, /RTP-Info: url=rtsp:\/\/192\.168\.2\.236:554\/profile1\/track1;seq=56350/);
            assert.match(e.message, /\\r\\n/);
            assert.match(e.message, /52 54 50 2d 49 6e 66 6f/);
            return true;
        });
    });
}

async function main() {
    const tests = [
        testLegacyReaderStopsEarly,
        testLumaPlayResponse,
        testPlainMessageUnchanged,
        testBareLfUnchanged,
        testFoldedHeader,
        testWhitespaceOnlyLinesDoNotTerminate,
        testFirstLineNotFolded,
        testRawLineLogging,
        testRtspClientReadLoop,
        testBadHeaderErrorIncludesContext,
    ];
    let failed = 0;
    for (const test of tests) {
        try {
            await test();
            console.log('ok  ', test.name);
        }
        catch (e) {
            failed++;
            console.log('FAIL', test.name);
            console.log(e);
        }
    }
    console.log(failed ? `${failed} test(s) failed` : `all ${tests.length} tests passed`);
    process.exit(failed ? 1 : 0);
}

main();
