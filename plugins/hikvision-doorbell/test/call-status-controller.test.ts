import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallStatusController } from '../src/call-status-controller';
import { HikvisionDoorbellEvent } from '../src/doorbell-events';

const { TalkInvite, TalkHangup, TalkOnCall } = HikvisionDoorbellEvent;

function setup (mode: 'poll' | 'push')
{
    const emitted: HikvisionDoorbellEvent[] = [];
    const polling: boolean[] = [];
    const controller = new CallStatusController ({
        mode,
        emit: (e) => emitted.push (e),
        setPolling: (on) => polling.push (on),
    });
    return { controller, emitted, polling };
}

test('poll mode maps transitions like 2.0.8', () => {
    const { controller, emitted, polling } = setup ('poll');
    controller.start();
    assert.deepEqual (polling, [true]);
    for (const s of ['idle', 'ring', 'ring', 'onCall', 'onCall', 'idle', 'idle'] as const) {
        controller.onPollStatus (s);
    }
    assert.deepEqual (emitted, [TalkInvite, TalkOnCall, TalkHangup]);
    assert.deepEqual (polling, [true]);
});

test('push mode polls until sdk ready', () => {
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    assert.deepEqual (polling, [true]);
    controller.onPollStatus ('ring');
    assert.deepEqual (emitted, [TalkInvite]);
});

test('push call flow', () => {
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    controller.onSdkReady();
    assert.deepEqual (polling, [true, false]);
    controller.onSdkRing();
    assert.deepEqual (emitted, [TalkInvite]);
    assert.deepEqual (polling, [true, false, true]);
    controller.onPollStatus ('ring');
    assert.deepEqual (emitted, [TalkInvite]);
    controller.onPollStatus ('onCall');
    assert.deepEqual (emitted, [TalkInvite, TalkOnCall]);
    controller.onSdkEnd();
    assert.deepEqual (emitted, [TalkInvite, TalkOnCall, TalkHangup]);
    assert.deepEqual (polling, [true, false, true, false]);
    controller.onPollStatus ('idle');
    assert.deepEqual (emitted, [TalkInvite, TalkOnCall, TalkHangup]);
    controller.destroy();
});

test('unanswered call with 30 s onCall', () => {
    const { controller, emitted } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    controller.onPollStatus ('onCall');
    controller.onSdkEnd();
    assert.deepEqual (emitted, [TalkInvite, TalkOnCall, TalkHangup]);
    controller.destroy();
});

test('poll idle ends call when 18 is lost', () => {
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    controller.onPollStatus ('ring');
    controller.onPollStatus ('idle');
    assert.deepEqual (emitted, [TalkInvite, TalkHangup]);
    assert.deepEqual (polling, [true, false, true, false]);
    controller.onSdkEnd();
    assert.deepEqual (emitted, [TalkInvite, TalkHangup]);
});

test('poll idle before the poll has seen the call does not end it', () => {
    // the station's callStatus can trail the SDK alarm by a poll or two
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    controller.onPollStatus ('idle');
    controller.onPollStatus ('ring');
    assert.deepEqual (emitted, [TalkInvite]);
    assert.deepEqual (polling, [true, false, true]);
    controller.destroy();
});

test('second ring during call re-invites, one hangup', () => {
    const { controller, emitted } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    controller.onSdkRing();
    controller.onSdkEnd();
    controller.onSdkEnd();
    assert.deepEqual (emitted, [TalkInvite, TalkInvite, TalkHangup]);
});

test('call cap ends call', (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    t.mock.timers.tick (299999);
    assert.deepEqual (emitted, [TalkInvite]);
    t.mock.timers.tick (1);
    assert.deepEqual (emitted, [TalkInvite, TalkHangup]);
    assert.deepEqual (polling, [true, false, true, false]);
});

test('sdk down resumes continuous polling', () => {
    const { controller, emitted, polling } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkDown();
    assert.deepEqual (polling, [true, false, true]);
    controller.onPollStatus ('ring');
    assert.deepEqual (emitted, [TalkInvite]);
    controller.onSdkReady();
    assert.deepEqual (polling, [true, false, true]);
    controller.onPollStatus ('idle');
    assert.deepEqual (emitted, [TalkInvite, TalkHangup]);
    assert.deepEqual (polling, [true, false, true, false]);
});

test('destroy stops the cap timer', (t) => {
    t.mock.timers.enable ({ apis: ['setTimeout'] });
    const { controller, emitted } = setup ('push');
    controller.start();
    controller.onSdkReady();
    controller.onSdkRing();
    controller.destroy();
    t.mock.timers.tick (300000);
    controller.onSdkEnd();
    assert.deepEqual (emitted, [TalkInvite]);
});
