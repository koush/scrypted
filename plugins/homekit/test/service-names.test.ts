// Run with: node --experimental-strip-types --test test/service-names.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfiguredName, Name, On } from '@homebridge/hap-nodejs/dist/lib/definitions/CharacteristicDefinitions.js';
import { ContactSensor, Doorbell, Lightbulb, MotionSensor, StatelessProgrammableSwitch, Switch } from '@homebridge/hap-nodejs/dist/lib/definitions/ServiceDefinitions.js';
import { IdentifierCache } from '@homebridge/hap-nodejs/dist/lib/model/IdentifierCache.js';
import { toShortForm } from '@homebridge/hap-nodejs/dist/lib/util/uuid.js';
import { setServiceName } from '../src/service-names.ts';

test('motion, contact, and button services advertise distinct names', () => {
    const services = [
        [new MotionSensor('Doorbell'), 'Doorbell Motion'],
        [new ContactSensor('Doorbell'), 'Doorbell Contact'],
        [new Doorbell(), 'Doorbell Button'],
        [new StatelessProgrammableSwitch('Doorbell'), 'Doorbell Automation Button'],
    ] as const;

    for (const [service, name] of services) {
        const warnings: unknown[] = [];
        service.on('characteristic-warning', warning => warnings.push(warning));
        setServiceName(service, name);
        assert.equal(service.getCharacteristic(Name).value, name);
        assert.equal(service.getCharacteristic(ConfiguredName).value, name);
        assert.equal(service.displayName, name);
        assert.equal(warnings.length, 0);
    }
});

test('merged controls retain their individual names and service identities', () => {
    const light = new Lightbulb('Doorbell Floodlight', 'camera-floodlight');
    const motionLight = new Lightbulb('Doorbell Motion Floodlight', 'camera-motion-floodlight');
    const siren = new Switch('Doorbell Siren', 'camera-siren');
    const motionSiren = new Switch('Doorbell Motion-Siren', 'camera-motion-siren');
    for (const service of [light, motionLight, siren, motionSiren]) {
        const identity = service.getServiceId();
        const name = service.displayName;
        setServiceName(service, name);
        assert.equal(service.getServiceId(), identity);
        assert.equal(service.getCharacteristic(ConfiguredName).value, name);
    }
    assert.notEqual(light.getServiceId(), motionLight.getServiceId());
    assert.notEqual(siren.getServiceId(), motionSiren.getServiceId());
});

test('updating a label does not duplicate characteristics or invoke control handlers', () => {
    const service = new Switch('Doorbell', 'camera-floodlight');
    let toggles = 0;
    service.getCharacteristic(On).onSet(() => { toggles++; });
    setServiceName(service, 'Doorbell Floodlight');
    const count = service.characteristics.length;
    setServiceName(service, 'Porch Floodlight');
    assert.equal(service.characteristics.length, count);
    assert.equal(service.getCharacteristic(Name).value, 'Porch Floodlight');
    assert.equal(service.getCharacteristic(ConfiguredName).value, 'Porch Floodlight');
    assert.equal(toggles, 0);
});

test('services that already support ConfiguredName do not gain duplicate optional entries', () => {
    const service = new MotionSensor('Doorbell');
    service.addOptionalCharacteristic(ConfiguredName);
    setServiceName(service, 'Doorbell Motion');
    setServiceName(service, 'Doorbell Motion');
    assert.equal(service.optionalCharacteristics.filter(c => c.UUID === ConfiguredName.UUID).length, 1);
});

test('the HomeKit accessories response includes both name characteristics', async () => {
    const service = new ContactSensor('Doorbell');
    setServiceName(service, 'Doorbell Contact');
    service._assignIDs(new IdentifierCache('00:00:00:00:00:00'), 'doorbell-accessory');
    const serialized = await service.toHAP(undefined, false);
    for (const uuid of [Name.UUID, ConfiguredName.UUID]) {
        assert.equal(serialized.characteristics.find(c => c.type === toShortForm(uuid))?.value, 'Doorbell Contact');
    }
});

test('recreating a named service preserves existing HomeKit instance IDs', () => {
    const cache = new IdentifierCache('00:00:00:00:00:00');
    const original = new Switch('Doorbell Floodlight', 'camera-floodlight');
    original._assignIDs(cache, 'doorbell-accessory');
    const updated = new Switch('Doorbell Floodlight', 'camera-floodlight');
    setServiceName(updated, 'Doorbell Floodlight');
    updated._assignIDs(cache, 'doorbell-accessory');
    assert.equal(updated.iid, original.iid);
    for (const characteristic of original.characteristics) {
        assert.equal(updated.characteristics.find(c => c.UUID === characteristic.UUID)?.iid, characteristic.iid);
    }
});

test('device-provided names are preserved verbatim', () => {
    const device = { name: 'Doorbell Motion-Floodlight' };
    const service = new Switch(device.name, 'camera-motion-floodlight');
    setServiceName(service, device.name);
    assert.equal(device.name, 'Doorbell Motion-Floodlight');
    assert.equal(service.getCharacteristic(Name).value, 'Doorbell Motion-Floodlight');
    assert.equal(service.getCharacteristic(ConfiguredName).value, 'Doorbell Motion-Floodlight');
    setServiceName(service, 'TP-Link Porch Light');
    assert.equal(service.getCharacteristic(Name).value, 'TP-Link Porch Light');
});
