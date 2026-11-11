import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, refuseSdkRequest, SdkUploadSession } from '../src/sdk/sdk-upload';
import { SdkInfo } from '../src/sdk/sdk-package';

const INFO: SdkInfo = { version: '6.1.9.48_build20230410', arch: 'arm64', libDir: '/volume/hcnetsdk', installedAt: '2026-11-02T00:00:00.000Z' };

function setup (install: (zip: Buffer) => Promise<SdkInfo> = async () => INFO)
{
    const sent: any[] = [];
    const installed: Buffer[] = [];
    const session = new SdkUploadSession (async (zip) => {
        installed.push (zip);
        return install (zip);
    }, (s) => sent.push (JSON.parse (s)));
    return { session, sent, installed };
}

const settle = () => new Promise ((resolve) => setImmediate (resolve));
const data = (bytes: Buffer) => Buffer.concat ([Buffer.from ([0]), bytes]);

test('binary before start is an error', () => {
    const { session, sent } = setup();
    session.onBinary (Buffer.from ('PK'));
    assert.equal (sent.length, 1);
    assert.ok (sent[0].error);
});

test('size above 200 MB rejected', () => {
    const { session, sent } = setup();
    session.onText (JSON.stringify ({ start: { size: MAX_UPLOAD_BYTES + 1, name: 'big.zip' } }));
    assert.equal (sent.length, 1);
    assert.match (sent[0].error, /200 MB/);
});

test('size mismatch at end rejected', async () => {
    const { session, sent, installed } = setup();
    session.onText (JSON.stringify ({ start: { size: 10, name: 'sdk.zip' } }));
    session.onBinary (Buffer.alloc (4));
    session.onText (JSON.stringify ({ end: true }));
    await settle();
    assert.equal (installed.length, 0);
    assert.match (sent.at (-1).error, /4 of 10/);
});

test('happy path installs concatenated bytes and replies ok', async () => {
    const { session, sent, installed } = setup();
    const part1 = Buffer.alloc (700 * 1024, 1);
    const part2 = Buffer.alloc (700 * 1024, 2);
    session.onText (JSON.stringify ({ start: { size: part1.length + part2.length, name: 'sdk.zip' } }));
    session.onBinary (part1);
    session.onBinary (part2);
    session.onText (JSON.stringify ({ end: true }));
    await settle();
    assert.equal (installed.length, 1);
    assert.ok (installed[0].equals (Buffer.concat ([part1, part2])));
    assert.deepEqual (sent.filter ((m) => 'progress' in m), [{ progress: part1.length + part2.length }]);
    assert.deepEqual (sent.at (-1), { ok: INFO });
});

test('install failure is reported', async () => {
    const { session, sent } = setup (async () => { throw new Error ('The zip has no libhcnetsdk.so.'); });
    session.onText (JSON.stringify ({ start: { size: 2, name: 'sdk.zip' } }));
    session.onBinary (Buffer.from ('PK'));
    session.onText (JSON.stringify ({ end: true }));
    await settle();
    assert.deepEqual (sent.at (-1), { error: 'The zip has no libhcnetsdk.so.' });
});

test('frames arriving as bytes are told apart by the 0x00 data marker', async () => {
    // Scrypted hands WebSocket text frames to the plugin as bytes, like binary ones
    const { session, sent, installed } = setup();
    session.onMessage (Buffer.from (JSON.stringify ({ start: { size: 2, name: 'sdk.zip' } })));
    session.onMessage (data (Buffer.from ('PK')));
    session.onMessage (new Uint8Array (Buffer.from (JSON.stringify ({ end: true }))).buffer);
    await settle();
    assert.ok (installed[0].equals (Buffer.from ('PK')));
    assert.deepEqual (sent.at (-1), { ok: INFO });
    session.onMessage ('{"end":true}');
    assert.ok (sent.at (-1).error);
});

test('sdk requests need a signed-in admin from the same origin', () => {
    const admin = { username: 'admin', headers: { host: '192.0.2.10:10443', origin: 'https://192.0.2.10:10443' } };
    assert.equal (refuseSdkRequest (admin), undefined);
    assert.equal (refuseSdkRequest ({ username: 'admin', headers: { host: '192.0.2.10:10443' } }), undefined);
    assert.ok (refuseSdkRequest ({ ...admin, isPublicEndpoint: true }));
    assert.ok (refuseSdkRequest ({ ...admin, username: undefined }));
    assert.ok (refuseSdkRequest ({ ...admin, aclId: 'viewer' }));
    assert.ok (refuseSdkRequest ({ ...admin, headers: { ...admin.headers, origin: 'https://evil.example' } }));
    assert.ok (refuseSdkRequest ({ ...admin, headers: { ...admin.headers, origin: 'not a url' } }));
});
