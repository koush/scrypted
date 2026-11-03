/**
 * Regression test for the stale floodlight / PIR child reference bug.
 *
 * Scenario (seen on the Home Hub Pro, 2026-10-30): at startup the hub reports some
 * channels "device offline", so the camera's abilities read as reduced/absent.
 * reportDevices() then omits the `<cam>-floodlight` / `<cam>-pir` children, the
 * server removes them, but the camera keeps its cached `this.floodlight`, and every
 * 15 s status poll throws `TypeError: Cannot read properties of undefined (reading 'id')`
 * from the SDK's lazy device-state lookup, which also skips the PTZ/OSD refresh.
 *
 * Run: npx tsx test/stale-children.test.ts
 */
import assert from 'node:assert/strict';
import sdk from '@scrypted/sdk';
import { ReolinkNvrCamera } from '../src/nvr/camera';

// ---- minimal in-memory DeviceManager, mirroring server/src/plugin/device.ts semantics ----
class MemStorage {
    map = new Map<string, string>();
    get length() { return this.map.size; }
    key(i: number) { return [...this.map.keys()][i] ?? null; }
    getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
    setItem(k: string, v: string) { this.map.set(k, String(v)); }
    removeItem(k: string) { this.map.delete(k); }
    clear() { this.map.clear(); }
}
const storages = new Map<string, MemStorage>();
const registered = new Map<string, { id: string, state: any }>();
const manifests: any[] = [];
let nextId = 1;
function register(nativeId: string) {
    if (!registered.has(nativeId))
        registered.set(nativeId, { id: `id${nextId++}`, state: {} });
}
(sdk as any).deviceManager = {
    getDeviceStorage: (nativeId: string) => {
        if (!storages.has(nativeId)) storages.set(nativeId, new MemStorage());
        return storages.get(nativeId);
    },
    getDeviceConsole: () => console,
    getDeviceLogger: () => console,
    getMixinConsole: () => console,
    // Real server: `this.nativeIds.get(nativeId).id` -> TypeError when the device was removed.
    getDeviceState: (nativeId: string) => {
        const entry = registered.get(nativeId);
        const id = entry.id;
        return new Proxy(entry.state, { get: (t, p) => p === 'id' ? id : t[p as any] });
    },
    getNativeIds: () => [...registered.keys()],
    onDeviceEvent: async () => { },
    onDevicesChanged: async (manifest: any) => {
        manifests.push(manifest);
        const keep = new Set(manifest.devices.map((d: any) => d.nativeId));
        for (const nativeId of [...registered.keys()]) {
            if (nativeId.startsWith(manifest.providerNativeId + '-') && !keep.has(nativeId))
                registered.delete(nativeId);   // server removes it; releaseDevice may never arrive
        }
        for (const d of manifest.devices) register(d.nativeId);
    },
    onDeviceDiscovered: async (d: any) => { register(d.nativeId); return registered.get(d.nativeId)!.id; },
};
(sdk as any).systemManager = { getDeviceById: () => ({}) };

// ---- NVR device stub ----
const CH = 3;
const nvrStorage: any = { abilities: {}, devicesData: {} };
const nvrDevice: any = {
    plugin: {},
    nativeId: 'hub',
    cameraNativeMap: new Map(),
    storageSettings: { values: nvrStorage },
    client: undefined,
    getClient: () => undefined,
    ensureOnvifEvents: async () => { },
};
const setAbilities = (floodlightVer: number, pirVer: number) => {
    nvrStorage.abilities = { Ability: { abilityChn: { [CH]: { floodLight: { ver: floodlightVer }, mdWithPir: { ver: pirVer } } } } };
};
const setOnline = (online: number) => {
    nvrStorage.devicesData = { [CH]: { channelStatus: { channel: CH, online, uid: 'u3', name: 'Cam 3' } } };
};

const CAM = 'cam3';
register(CAM);
registered.get(CAM)!.state.interfaces = [];
(sdk as any).deviceManager.getDeviceStorage(CAM).setItem('rtspChannel', String(CH));

const statusData = { floodlightEnabled: true, pirEnabled: true, ptzPresets: [{ id: 1, name: 'Door' }], osd: [{ channel: CH }] } as any;

async function main() {
    setAbilities(1, 1);
    setOnline(1);
    const cam = new ReolinkNvrCamera(CAM, nvrDevice);

    // Healthy startup: both children reported and instantiated by the server.
    await cam.reportDevices();
    assert.deepEqual(manifests.at(-1).devices.map((d: any) => d.nativeId).sort(), [`${CAM}-floodlight`, `${CAM}-pir`]);
    await cam.getDevice(`${CAM}-floodlight`);
    await cam.getDevice(`${CAM}-pir`);
    assert.ok(cam.floodlight && cam.pirSensor);
    await cam.processDeviceStatusData(statusData);
    assert.equal(cam.floodlight.on, true);

    // 1. Channel offline: capabilities are unknowable, children must be left alone.
    const before = manifests.length;
    setAbilities(0, 0);
    setOnline(0);
    await cam.reportDevices();
    assert.equal(manifests.length, before, 'reportDevices must not touch children while the channel is offline');
    assert.ok(registered.has(`${CAM}-floodlight`), 'floodlight child must survive an offline channel');

    // 2. Abilities entirely missing (hub info not fetched yet): same rule.
    nvrStorage.abilities = {};
    setOnline(1);
    await cam.reportDevices();
    assert.equal(manifests.length, before, 'reportDevices must not touch children without abilities');

    // 2b. Camera dropped from the hub's channel table (what a flat battery looks like):
    //     GetChannelstatus has no uid for it, so there is no deviceData, and GetAbility
    //     returns an all-zero stub. Children must survive.
    setAbilities(0, 0);
    nvrStorage.devicesData = {};
    await cam.reportDevices();
    assert.equal(manifests.length, before, 'reportDevices must not touch children of a camera the hub no longer lists');
    assert.ok(registered.has(`${CAM}-floodlight`));

    // 3. Capability genuinely gone while online: children removed AND cached refs dropped,
    //    even though the server never delivered releaseDevice (observed: "releaseDevice not implemented").
    setAbilities(0, 0);
    setOnline(1);
    await cam.reportDevices();
    assert.equal(manifests.length, before + 1);
    assert.equal(registered.has(`${CAM}-floodlight`), false);
    assert.equal(cam.floodlight, undefined, 'floodlight ref must be cleared when the child is no longer reported');
    assert.equal(cam.pirSensor, undefined, 'pir ref must be cleared when the child is no longer reported');
    await cam.processDeviceStatusData(statusData);     // must not throw

    // 4. Defence in depth: a stale ref that slipped through must not break the poll,
    //    and PTZ presets / OSD must still be refreshed.
    await cam.getDevice(`${CAM}-floodlight`);          // re-create a ref for a child the server does not know
    assert.ok(cam.floodlight);
    cam.storageSettings.values.cachedPresets = [];
    cam.storageSettings.values.cachedOsd = [];
    await cam.processDeviceStatusData(statusData);     // currently throws TypeError (reading 'id')
    assert.deepEqual(cam.storageSettings.values.cachedPresets, statusData.ptzPresets, 'presets must refresh despite a stale child');
    assert.deepEqual(cam.storageSettings.values.cachedOsd, statusData.osd, 'osd must refresh despite a stale child');
    assert.equal(cam.floodlight, undefined, 'stale floodlight ref must be dropped after the failed update');

    // 5. Capability returns (hub recovered): children re-reported, refs re-creatable.
    setAbilities(1, 1);
    await cam.reportDevices();
    assert.deepEqual(manifests.at(-1).devices.map((d: any) => d.nativeId).sort(), [`${CAM}-floodlight`, `${CAM}-pir`]);
    await cam.getDevice(`${CAM}-floodlight`);
    await cam.processDeviceStatusData(statusData);
    assert.equal(cam.floodlight.on, true);

    console.log('PASS stale-children');
}

main().then(() => process.exit(0), e => { console.error('FAIL', e); process.exit(1); });
