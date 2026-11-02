/**
 * Regression test for the partial-hub-reply crash in ReolinkNvrDevice.syncEntitiesFromRemote.
 *
 * Scenario (seen on the Home Hub Pro, 69 hits 2026-10-16..11-01): while the hub is flaky,
 * GetChnTypeInfo answers `rcv failed` (rspCode -17) for a channel, so getDevicesInfo()
 * leaves that channel's `channelInfo` undefined. The sync then threw
 * `TypeError: Cannot read properties of undefined (reading 'typeInfo')`, aborting the
 * events-flow tick and skipping the per-camera reportDevices() resync that follows it.
 *
 * Run: npx tsx test/hub-sync.test.ts
 */
import assert from 'node:assert/strict';
import sdk from '@scrypted/sdk';
import { ReolinkNvrDevice } from '../src/nvr/nvr';

const registered = new Set<string>();
(sdk as any).deviceManager = {
    getNativeIds: () => [...registered],
    getDeviceStorage: () => ({ getItem: () => null, setItem: () => { }, removeItem: () => { }, length: 0, key: () => null, clear: () => { } }),
    getDeviceConsole: () => console,
    getDeviceLogger: () => console,
};

const logs: string[] = [];
function makeHub(devicesInfo: { channels?: number[], devicesData?: any }) {
    const hub: any = Object.create(ReolinkNvrDevice.prototype);
    hub.nativeId = 'hub';
    hub.discoveredDevices = new Map();
    hub.getClient = () => ({ getDevicesInfo: async () => devicesInfo });
    hub.getLogger = () => ({ log: (...a: any[]) => logs.push(a.join(' ')), error: console.error, warn: console.warn });
    return hub as ReolinkNvrDevice;
}

const status = (channel: number, uid: string, name: string) => ({ channel, uid, name, online: 1 });

async function main() {
    // 1. Healthy reply: new cameras are discovered with their model.
    {
        const hub = makeHub({
            channels: [0, 1],
            devicesData: {
                0: { channelStatus: status(0, 'U0', 'Back Door'), channelInfo: { typeInfo: 'Reolink Duo 3' } },
                1: { channelStatus: status(1, 'U1', 'Garage'), channelInfo: { typeInfo: 'RLC-823A' } },
            },
        });
        await hub.syncEntitiesFromRemote();
        const found = await hub.discoverDevices(false);
        assert.deepEqual(found.map(d => [d.nativeId, d.name, d.info?.model]),
            [['hub-U0', 'Back Door', 'Reolink Duo 3'], ['hub-U1', 'Garage', 'RLC-823A']]);
    }

    // 2. GetChnTypeInfo failed for one channel (channelInfo undefined): no throw, the
    //    healthy channel is still discovered, the broken one is deferred to the next fetch.
    {
        const hub = makeHub({
            channels: [0, 1],
            devicesData: {
                0: { channelStatus: status(0, 'U0', 'Back Door') },
                1: { channelStatus: status(1, 'U1', 'Garage'), channelInfo: { typeInfo: 'RLC-823A' } },
            },
        });
        await hub.syncEntitiesFromRemote();
        const found = await hub.discoverDevices(false);
        assert.deepEqual(found.map(d => d.nativeId), ['hub-U1']);
    }

    // 3. Already-adopted camera with a partial reply: untouched, no throw.
    {
        registered.add('hub-U0');
        const hub = makeHub({
            channels: [0],
            devicesData: { 0: { channelStatus: status(0, 'U0', 'Back Door') } },
        });
        await hub.syncEntitiesFromRemote();
        assert.equal((await hub.discoverDevices(false)).length, 0);
        registered.clear();
    }

    // 4. Channel listed but its status / uid is missing, or devicesData lacks the channel.
    {
        const hub = makeHub({
            channels: [0, 8, 9],
            devicesData: {
                0: { channelStatus: status(0, 'U0', 'Back Door'), channelInfo: { typeInfo: 'Reolink Duo 3' } },
                8: { channelInfo: { typeInfo: 'TrackMix' } },
            },
        });
        await hub.syncEntitiesFromRemote();
        assert.deepEqual((await hub.discoverDevices(false)).map(d => d.nativeId), ['hub-U0']);
    }

    // 5. GetChannelstatus itself came back empty: channels undefined, nothing to do.
    {
        const hub = makeHub({ channels: undefined, devicesData: {} });
        await hub.syncEntitiesFromRemote();
        assert.equal((await hub.discoverDevices(false)).length, 0);
    }

    console.log('PASS hub-sync');
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
