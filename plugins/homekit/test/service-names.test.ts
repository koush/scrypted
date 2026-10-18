// Run with: node --experimental-strip-types --test test/service-names.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfiguredName, Name, On } from '@homebridge/hap-nodejs/dist/lib/definitions/CharacteristicDefinitions.js';
import { ContactSensor, Doorbell, MotionSensor, StatelessProgrammableSwitch, Switch } from '@homebridge/hap-nodejs/dist/lib/definitions/ServiceDefinitions.js';
import { IdentifierCache } from '@homebridge/hap-nodejs/dist/lib/model/IdentifierCache.js';
import { toShortForm } from '@homebridge/hap-nodejs/dist/lib/util/uuid.js';
import { setServiceName } from '../src/service-names.ts';

test('motion, contact, and button services advertise distinct names', () => {
    const services = [
        [new MotionSensor('Entrance'), 'Entrance Motion'],
        [new ContactSensor('Entrance'), 'Entrance Contact'],
        [new Doorbell(), 'Entrance Button'],
        [new StatelessProgrammableSwitch('Entrance'), 'Entrance Automation Button'],
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
    const light = new Switch('Patio Light', 'primary-light');
    const secondaryLight = new Switch('Garage Light', 'secondary-light');
    const siren = new Switch('Entrance Siren', 'primary-siren');
    const secondarySiren = new Switch('Garage Siren', 'secondary-siren');
    for (const service of [light, secondaryLight, siren, secondarySiren]) {
        const identity = service.getServiceId();
        const name = service.displayName;
        setServiceName(service, name);
        assert.equal(service.getServiceId(), identity);
        assert.equal(service.getCharacteristic(ConfiguredName).value, name);
    }
    assert.notEqual(light.getServiceId(), secondaryLight.getServiceId());
    assert.notEqual(siren.getServiceId(), secondarySiren.getServiceId());
});

test('updating a label does not duplicate characteristics or invoke control handlers', () => {
    const service = new Switch('Entrance', 'primary-light');
    let toggles = 0;
    service.getCharacteristic(On).onSet(() => { toggles++; });
    setServiceName(service, 'Patio Light');
    const count = service.characteristics.length;
    setServiceName(service, 'Porch Light');
    assert.equal(service.characteristics.length, count);
    assert.equal(service.getCharacteristic(Name).value, 'Porch Light');
    assert.equal(service.getCharacteristic(ConfiguredName).value, 'Porch Light');
    assert.equal(toggles, 0);
});

test('services that already support ConfiguredName do not gain duplicate optional entries', () => {
    const service = new MotionSensor('Entrance');
    service.addOptionalCharacteristic(ConfiguredName);
    setServiceName(service, 'Entrance Motion');
    setServiceName(service, 'Entrance Motion');
    assert.equal(service.optionalCharacteristics.filter(c => c.UUID === ConfiguredName.UUID).length, 1);
});

test('the HomeKit accessories response includes both name characteristics', async () => {
    const service = new ContactSensor('Entrance');
    setServiceName(service, 'Entrance Contact');
    service._assignIDs(new IdentifierCache('00:00:00:00:00:00'), 'test-accessory');
    const serialized = await service.toHAP(undefined, false);
    for (const uuid of [Name.UUID, ConfiguredName.UUID]) {
        assert.equal(serialized.characteristics.find(c => c.type === toShortForm(uuid))?.value, 'Entrance Contact');
    }
});

test('recreating a named service preserves existing HomeKit instance IDs', () => {
    const cache = new IdentifierCache('00:00:00:00:00:00');
    const original = new Switch('Patio Light', 'primary-light');
    original._assignIDs(cache, 'test-accessory');
    const updated = new Switch('Patio Light', 'primary-light');
    setServiceName(updated, 'Patio Light');
    updated._assignIDs(cache, 'test-accessory');
    assert.equal(updated.iid, original.iid);
    for (const characteristic of original.characteristics) {
        assert.equal(updated.characteristics.find(c => c.UUID === characteristic.UUID)?.iid, characteristic.iid);
    }
});

test('device-provided names are preserved verbatim', () => {
    const device = { name: 'Kitchen-A Switch' };
    const service = new Switch(device.name, 'secondary-light');
    setServiceName(service, device.name);
    assert.equal(device.name, 'Kitchen-A Switch');
    assert.equal(service.getCharacteristic(Name).value, 'Kitchen-A Switch');
    assert.equal(service.getCharacteristic(ConfiguredName).value, 'Kitchen-A Switch');
    setServiceName(service, 'Porch-Left Light');
    assert.equal(service.getCharacteristic(Name).value, 'Porch-Left Light');
});
