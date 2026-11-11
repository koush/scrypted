import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushStatusText } from '../src/sdk/sdk-host';
import { SdkInfo } from '../src/sdk/sdk-package';

const INSTALLED: SdkInfo = { version: 'unknown', arch: 'arm64', libDir: '/volume/hcnetsdk', installedAt: '2026-11-02T00:00:00.000Z' };

test('push status text', () => {
    assert.equal (pushStatusText ({ supported: false, reason: 'Push needs python3 on the Scrypted server.', installed: null }),
        'Unsupported: Push needs python3 on the Scrypted server - polling');
    assert.equal (pushStatusText ({ supported: true, installed: null }), 'SDK not installed - polling');
    assert.equal (pushStatusText ({ supported: true, installed: INSTALLED }), 'Starting');
    assert.equal (pushStatusText ({ supported: true, installed: INSTALLED }, { state: 'starting' }), 'Starting');
    assert.equal (pushStatusText ({ supported: true, installed: INSTALLED }, { state: 'armed' }), 'Armed');
    assert.equal (pushStatusText ({ supported: true, installed: INSTALLED }, { state: 'down', reason: 'station connection lost' }),
        'Down (station connection lost) - polling');
});
