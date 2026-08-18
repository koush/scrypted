import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMotionEvent, shouldTriggerMotionFromEvent, UnifiMotionDevice } from '../src/camera-sensors';

test('regular motion events always trigger motion', () => {
    assert.equal(shouldTriggerMotionFromEvent('motion', false), true);
});

test('smart detection events only trigger motion when enabled', () => {
    assert.equal(shouldTriggerMotionFromEvent('smartDetectZone', false), false);
    assert.equal(shouldTriggerMotionFromEvent('smartDetectLine', false), false);
    assert.equal(shouldTriggerMotionFromEvent('smartDetectZone', true), true);
    assert.equal(shouldTriggerMotionFromEvent('smartDetectLine', true), true);
});

test('unrelated events do not trigger motion', () => {
    assert.equal(shouldTriggerMotionFromEvent('ring', true), false);
    assert.equal(shouldTriggerMotionFromEvent('fingerprintIdentified', true), false);
});

test('event routing invokes the existing motion debounce only for configured events', () => {
    const states: boolean[] = [];
    const device: UnifiMotionDevice = {
        motionTimeout: setTimeout(() => undefined, 0),
        setMotionDetected: state => states.push(state),
    };

    assert.equal(handleMotionEvent(device, 'smartDetectZone', false), false);
    assert.deepEqual(states, []);

    assert.equal(handleMotionEvent(device, 'smartDetectZone', true), true);
    assert.deepEqual(states, [true]);

    assert.equal(handleMotionEvent(device, 'motion', false), true);
    assert.deepEqual(states, [true, true]);

    clearTimeout(device.motionTimeout);
});