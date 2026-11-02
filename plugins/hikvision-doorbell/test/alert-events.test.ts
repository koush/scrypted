import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAcsEvent } from '../src/alert-events';

test('reads major, minor and door from an inline AccessControllerEvent', () => {
    const event = {
        eventType: 'AccessControllerEvent',
        AccessControllerEvent: { majorEventType: 5, subEventType: 21, doorNo: 1 },
    };
    assert.deepEqual(inlineAcsEvent(event), { major: 5, minor: 21, doorNo: 1 });
});

test('door number is optional', () => {
    const event = { AccessControllerEvent: { majorEventType: 1, subEventType: 4168 } };
    assert.deepEqual(inlineAcsEvent(event), { major: 1, minor: 4168, doorNo: undefined });
});

test('returns undefined when the push carries no usable access-control fields', () => {
    assert.equal(inlineAcsEvent({ eventType: 'videoloss' }), undefined);
    assert.equal(inlineAcsEvent({ AccessControllerEvent: { majorEventType: '5', subEventType: 21 } }), undefined);
    assert.equal(inlineAcsEvent({ AccessControllerEvent: { subEventType: 21 } }), undefined);
    assert.equal(inlineAcsEvent(undefined), undefined);
});
