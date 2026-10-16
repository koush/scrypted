import crypto from 'crypto';
import net from 'net';
import { RtspClient, RtspServer, listenSingleRtspClient } from '../src';

const SDP = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=scrypted rtsp-server test',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    'm=video 0 RTP/AVP 96',
    'a=rtpmap:96 H264/90000',
    'a=control:trackID=0',
].join('\r\n') + '\r\n';

function timeout<T>(ms: number, message: string, promise: Promise<T>): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}

async function testPlayback() {
    const listener = await listenSingleRtspClient({
        hostname: '127.0.0.1',
        createServer: duplex => new RtspServer(duplex, SDP),
    });
    const client = new RtspClient(listener.url);
    const server = await listener.rtspServerPromise;
    const playback = server.handlePlayback();

    let resolveRtp: (rtp: Buffer) => void;
    const received = new Promise<Buffer>(resolve => resolveRtp = resolve);

    await client.options();
    const describe = await client.describe();
    if (!describe.body?.toString().includes('m=video'))
        throw new Error('DESCRIBE response missing sdp');

    await client.setup({
        type: 'tcp',
        port: 0,
        path: 'trackID=0',
        onRtp: (header, rtp) => resolveRtp(rtp),
    });
    await client.play();

    // readLoop is started after the RTSP handshakes complete: it consumes
    // the socket, so it must not race with the response readers above.
    client.readLoop().catch(() => { });

    const rtp = Buffer.from([0x80, 0x60, 0, 1, 0, 0, 0, 1, 0x12, 0x34, 0x56, 0x78, 9, 9, 9, 9]);
    server.sendTrack('trackID=0', rtp, false);

    const receivedPacket = await timeout(5000, 'rtp packet reception timed out', received);
    if (!receivedPacket.equals(rtp))
        throw new Error(`received rtp packet mismatch: ${receivedPacket.toString('hex')}`);

    const teardown = server.handleTeardown();
    await client.safeTeardown();
    await teardown;
    server.destroy();

    console.log('testPlayback passed');
}

async function testDigestAuth() {
    const realm = 'testrealm@host.com';
    const nonce = 'abc123';
    const username = 'user';
    const password = 'pass';

    let authServer: net.Server;
    const authServerStarted = new Promise<number>(resolve => {
        authServer = net.createServer();
        authServer.on('connection', socket => {
            socket.on('data', buffer => {
                const message = buffer.toString();
                const lines = message.split('\r\n');
                const cseq = lines.find(line => line.startsWith('CSeq:'))?.split(':')[1].trim();
                const isAuthed = message.includes('Authorization:');

                if (!isAuthed) {
                    socket.write(`RTSP/1.0 401 Unauthorized\r\nCSeq: ${cseq}\r\nWWW-Authenticate: Digest realm="${realm}", nonce="${nonce}"\r\n\r\n`);
                    return;
                }

                const authorization = lines.find(line => line.startsWith('Authorization:'));
                const responseHash = authorization?.match(/response="([^"]+)"/)?.[1];
                const uri = authorization?.match(/uri="([^"]+)"/)?.[1];
                if (!responseHash || !uri)
                    throw new Error('Authorization header missing response/uri');

                const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
                const ha2 = crypto.createHash('md5').update(`DESCRIBE:${uri}`).digest('hex');
                const expected = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
                if (responseHash !== expected)
                    throw new Error(`digest hash mismatch: expected ${expected}, received ${responseHash}`);

                if (lines[0].startsWith('DESCRIBE')) {
                    socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nContent-Base: ${uri}\r\nContent-Type: application/sdp\r\nContent-Length: ${Buffer.byteLength(SDP)}\r\n\r\n${SDP}`);
                }
                else {
                    socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\n\r\n`);
                }
            });
        });
        authServer.listen(0, '127.0.0.1', () => resolve((authServer.address() as net.AddressInfo).port));
    });
    const port = await authServerStarted;

    const client = new RtspClient(`rtsp://${username}:${password}@127.0.0.1:${port}/test`);
    const response = await client.describe();
    if (!response.body?.toString().includes('m=video'))
        throw new Error('DESCRIBE response missing sdp after digest auth');

    client.client.destroy();
    authServer.close();

    console.log('testDigestAuth passed');
}

async function main() {
    await testPlayback();
    await testDigestAuth();
    console.log('all tests passed');
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});