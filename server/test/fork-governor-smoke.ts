/**
 * Smoke tests for ForkGovernor.
 * Run with: npx ts-node test/fork-governor-smoke.ts
 * Or: npx tsc && node dist/test/fork-governor-smoke.js
 */
import { ForkGovernor, ForkGovernorRejected } from '../src/plugin/fork-governor';

async function assert(cond: any, msg: string) {
    if (!cond) throw new Error('FAIL: ' + msg);
    console.log('  ok -', msg);
}

async function test_no_backoff_on_fresh_key() {
    console.log('test: no backoff for first fork');
    const g = new ForkGovernor({ pluginId: 't', log: () => { } });
    const t0 = Date.now();
    await g.beforeFork('cam-1');
    const elapsed = Date.now() - t0;
    await assert(elapsed < 50, `first fork should be instant, took ${elapsed}ms`);
}

async function test_backoff_on_crash() {
    console.log('test: backoff after crashes');
    const g = new ForkGovernor({
        pluginId: 't',
        minBackoffMs: 100,
        maxBackoffMs: 500,
        log: () => { },
    });

    // Simulate 3 crashes
    for (let i = 0; i < 3; i++) {
        await g.beforeFork('cam-1');
        const h = g.registerSpawn('cam-1');
        h.onExit(1, null); // immediate non-zero exit
    }

    // Next fork should backoff
    const t0 = Date.now();
    await g.beforeFork('cam-1');
    const elapsed = Date.now() - t0;
    await assert(elapsed >= 80, `expected ~>=100ms backoff after 3 crashes, got ${elapsed}ms`);
    await assert(elapsed < 2000, `backoff should be capped, got ${elapsed}ms`);
}

async function test_hard_reject() {
    console.log('test: hard reject on crash storm');
    const g = new ForkGovernor({
        pluginId: 't',
        hardLimit: 5,
        hardCrashLimit: 3,
        minBackoffMs: 1,
        maxBackoffMs: 5,
        log: () => { },
    });

    for (let i = 0; i < 5; i++) {
        await g.beforeFork('cam-1');
        g.registerSpawn('cam-1').onExit(1, null);
    }

    let rejected = false;
    try {
        await g.beforeFork('cam-1');
    } catch (e) {
        rejected = e instanceof ForkGovernorRejected;
    }
    await assert(rejected, 'expected ForkGovernorRejected after crash storm');
}

async function test_isolation_between_keys() {
    console.log('test: keys are isolated');
    const g = new ForkGovernor({
        pluginId: 't',
        minBackoffMs: 200,
        maxBackoffMs: 1000,
        log: () => { },
    });

    // Crash cam-1 a bunch
    for (let i = 0; i < 4; i++) {
        await g.beforeFork('cam-1');
        g.registerSpawn('cam-1').onExit(1, null);
    }

    // cam-2 should still be unaffected
    const t0 = Date.now();
    await g.beforeFork('cam-2');
    const elapsed = Date.now() - t0;
    await assert(elapsed < 50, `cam-2 should be unaffected by cam-1 crashes, took ${elapsed}ms`);
}

async function test_stable_run_clears_crashes() {
    console.log('test: stable run clears crashes');
    const g = new ForkGovernor({
        pluginId: 't',
        minBackoffMs: 100,
        crashWindowMs: 10, // anything alive >10ms counts as not-an-instant-crash
        stableRunMs: 30,   // small for test
        log: () => { },
    });

    // 2 crashes
    for (let i = 0; i < 2; i++) {
        await g.beforeFork('cam-1');
        g.registerSpawn('cam-1').onExit(1, null);
    }

    // Now a stable run
    const h = g.registerSpawn('cam-1');
    await new Promise(r => setTimeout(r, 50));
    h.onExit(0, null); // clean long-lived exit

    const snap = g.snapshot().find(s => s.key === 'cam-1');
    await assert(!snap || snap.crashes === 0, `crashes should clear after stable run, got ${snap?.crashes}`);
}

async function test_disabled() {
    console.log('test: disabled governor is a no-op');
    const g = new ForkGovernor({ pluginId: 't', disabled: true, log: () => { } });
    for (let i = 0; i < 200; i++) {
        await g.beforeFork('cam-1');
        g.registerSpawn('cam-1').onExit(1, null);
    }
    // Should not throw, no backoff, no records.
    await assert(g.snapshot().length === 0, 'disabled governor should track nothing');
}

(async () => {
    try {
        await test_no_backoff_on_fresh_key();
        await test_backoff_on_crash();
        await test_hard_reject();
        await test_isolation_between_keys();
        await test_stable_run_clears_crashes();
        await test_disabled();
        console.log('\nALL ForkGovernor smoke tests passed.');
    } catch (e) {
        console.error('\nFAIL:', e);
        process.exit(1);
    }
})();
