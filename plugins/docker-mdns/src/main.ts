import { ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import multicastDns from 'multicast-dns';
import { MdnsServiceRecord } from '../service/src/mdns-service-record';
import net from 'net';

class DockerMdnsProxy extends ScryptedDeviceBase implements Settings {
    storageSettings = new StorageSettings(this, {
        hostAddress: {
            title: 'Host Address',
            description: 'The host address to use to proxy MDNS advertisements.',
            placeholder: '192.168.2.124',
        },
        discoverServices: {
            title: 'Services',
            description: 'The MDNS services to discover and proxy.',
            multiple: true,
            defaultValue: [
                '_hap._tcp.local',
            ],
        }
    });
    mdns: ReturnType<typeof multicastDns>;
    services: {
        [name: string]: MdnsServiceRecord;
    } = {};
    timeouts = new Map<string, NodeJS.Timeout>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.initialize();
    }

    initialize() {
        this.mdns?.destroy();

        this.mdns = multicastDns();

        const services = this.storageSettings.values.discoverServices as string[];

        this.mdns.on('response', (response) => {
            for (const answer of response.answers) {
                if (answer.type !== 'PTR')
                    continue;
                const { name: serviceName, ttl } = answer;
                if (!ttl)
                    continue;
                if (!services.includes(serviceName))
                    continue;

                const name = answer.data.toString();

                const srv = response.additionals.find(add => add.name === name && add.type === 'SRV');
                if (srv?.type !== 'SRV')
                    continue;
                const txt = response.additionals.find(add => add.name === name && add.type === 'TXT');
                if (txt?.type !== 'TXT')
                    continue;

                let txtData = txt.data;
                if (!Array.isArray(txtData))
                    txtData = [txtData];

                const mdnsServiceRecord: MdnsServiceRecord = {
                    name,
                    srv: srv.data,
                    txt: txtData.map(txt => txt.toString()),
                    ttl,
                    type: serviceName,
                };

                this.services[name] = mdnsServiceRecord;
                clearTimeout(this.timeouts.get(name));
                const timeout = setTimeout(() => delete this.services[name], ttl * 1000);
                this.timeouts.set(name, timeout);
                this.console.log('proxying service', mdnsServiceRecord);
            }

            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        });

        this.mdns.query({
            questions: this.storageSettings.values.discoverServices.map((name: string) => (
                {
                    name,
                    type: 'CNAME'
                }
            ))
        });
    }

    async getSettings(): Promise<Setting[]> {
        const ret = await this.storageSettings.getSettings();
        ret.push({
            key: 'rawServiceRecords',
            title: 'Raw Service Records',
            readonly: true,
            value: JSON.stringify(this.services),
        })
        return ret;
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        if (key === 'callback') {
            const host: string = this.storageSettings.values.hostAddress;
            const [local,remote] = value.toString().split(':');
            const socket = net.connect({
                port: parseInt(remote),
                host,
            });
            socket.pipe(net.connect(parseInt(local))).pipe(socket);
            return;
        }
        return this.storageSettings.putSetting(key, value);
    }
}

export default DockerMdnsProxy;
