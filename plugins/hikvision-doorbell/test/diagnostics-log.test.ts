import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticsLog } from '../src/sdk/diagnostics-log';

test('diagnostics log appends and rotates', () => {
    const dir = mkdtempSync (join (tmpdir(), 'hik-diag-'));
    try {
        const file = join (dir, 'diagnostics.jsonl');
        const log = new DiagnosticsLog (file, 200);
        for (let i = 0; i < 10; i++) {
            log.append ('sdk', { type: 'raw', i });
        }
        assert.ok (existsSync (file + '.1'));
        assert.ok (statSync (file).size < 200);
        for (const path of [file, file + '.1']) {
            for (const line of readFileSync (path, 'utf8').split ('\n').filter (Boolean)) {
                assert.deepEqual (Object.keys (JSON.parse (line)), ['t', 'kind', 'payload']);
            }
        }
    }
    finally {
        rmSync (dir, { recursive: true, force: true });
    }
});
