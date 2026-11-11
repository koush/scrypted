import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSidecarLine, SidecarMessage } from '../src/sdk/sidecar-protocol';

test('parses each protocol message', () => {
    const messages: SidecarMessage[] = [
        { type: 'ready', sdkVersion: '6.1.8.101' },
        { type: 'ring' },
        { type: 'end' },
        { type: 'error', stage: 'login', code: 1, message: 'NET_DVR_Login_V30 failed' },
        { type: 'disconnected' },
        { type: 'reconnected' },
        { type: 'raw', source: 'alarm', command: 4403, data: { byAlarmType: 17 } },
    ];
    for (const message of messages) {
        assert.deepEqual(parseSidecarLine(JSON.stringify(message)), message);
    }
});

test('returns undefined for invalid json or unknown type', () => {
    for (const line of ['', 'hpr tls index{2}', '[]', 'null', '{"type":"bogus"}', '{"type":"ready"}',
        '{"type":"error","stage":"login"}', '{"type":"raw","source":"alarm","command":"4403","data":{}}']) {
        assert.equal(parseSidecarLine(line), undefined, line);
    }
});
