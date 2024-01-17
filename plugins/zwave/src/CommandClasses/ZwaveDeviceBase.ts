import sdk, { ScryptedDeviceBase, Device, Refresh, Setting, Settings } from "@scrypted/sdk";
import { getHash } from "../Types";
import { CommandClassInfo, getCommandClassIndex, getCommandClass } from ".";
import { ZwaveControllerProvider, NodeLiveness } from "../main";
import { Endpoint, ValueID, ZWaveController, ZWaveNode, ZWaveNodeValueUpdatedArgs, NodeStatus, InterviewStage, ZWavePlusRoleType, NodeStatistics } from "zwave-js";
import { CommandClasses, ValueMetadataNumeric } from "@zwave-js/core"

const { deviceManager } = sdk;

export function containsAny(value: string, ...checks: string[]): boolean {
    for (const check of checks) {
        if (value?.indexOf(check) !== -1)
            return true;
    }

    return false;
}

export interface CommandClassHandler {
    valueId?: ValueID;
    property?: string;
    prototype: any;

    updateState?(zwaveDevice: ZwaveDeviceBase, valueId: ValueID): void;
    onValueChanged?(zwaveDevice: ZwaveDeviceBase, valueId: ZWaveNodeValueUpdatedArgs): void;
    getInterfaces?: (node: ZWaveNode, valueId: ValueID) => string[];
}

export class TransientState {
    lockJammed?: boolean;
}

export class ZwaveDeviceBase extends ScryptedDeviceBase implements Refresh, Settings {
    instance: Endpoint;
    device: Device;
    commandClasses: CommandClassInfo[] = [];
    zwaveController: ZwaveControllerProvider;
    transientState: TransientState = {};
    statistics: NodeStatistics;

    constructor(controller: ZWaveController, instance: Endpoint) {
        super(getHash(controller, instance));
        this.instance = instance;

        const node = this.instance.getNodeUnsafe()
        node.on('wake up', node => {
            this.console.log(`[${node.id}] woke up`)
        });
        node.on('sleep', node => {
            this.console.log(`[${node.id}] sleeping`)
        });
        node.on('statistics updated', (node: ZWaveNode, statistics: NodeStatistics) => {
            this.statistics = statistics;
        });
    }

    getValueId(valueId: ValueID): ValueID {
        return Object.assign({
            endpoint: this.instance.index,
        }, valueId);
    }

    getValue<T = unknown>(valueId: ValueID): T {
        return this.instance.getNodeUnsafe().getValue(this.getValueId(valueId));
    }

    onValueChanged(valueId: ZWaveNodeValueUpdatedArgs) {
        this.console.log('value changed', valueId);
        var cc = getCommandClassIndex(valueId.commandClass, valueId.property as number);
        if (!cc) {
            cc = getCommandClass(valueId.commandClass);
        }
        if (!cc) {
            return;
        }
        cc.handlerClass.onValueChanged?.(this, valueId);
        cc.handlerClass.updateState?.(this, valueId);
    }

    getValueUnit(valueId: ValueID): string {
        return (this.instance.getNodeUnsafe().getValueMetadata(valueId) as ValueMetadataNumeric).unit;
    }

    async getRefreshFrequency(): Promise<number> {
        return 30;
    }

    async refresh(refreshInterface: string, userInitiated: boolean) {
        // if it's not user initiated, ignore it. this is too expensive.
        if (!userInitiated) {
            return;
        }

        this.zwaveController.updateNodeLiveness(this, NodeLiveness.Query);

        for (var commandClass of this.commandClasses) {
            if (refreshInterface != null && !commandClass.interfaces.includes(refreshInterface)) {
                continue;
            }

            // these are expensive to refresh
            const cc = commandClass.handlerClass.valueId.commandClass;
            if (cc === CommandClasses['User Code'])
                continue;
            if (cc === CommandClasses['Configuration'])
                continue;

            this.instance.getNodeUnsafe().refreshCCValues(cc).then(() => this.zwaveController.updateNodeLiveness(this, NodeLiveness.Live));
        }
    }

    updateState() {
        for (var commandClass of this.commandClasses) {
            commandClass.handlerClass.updateState?.(this, commandClass.handlerClass.valueId);
        }
    }

    getSettings(): Promise<Setting[]> {
        return this.getZWaveSettings();
    }

    putSetting(key: string, value: string | number | boolean): Promise<void> {
        return this.putZWaveSetting(key, value);
    }
    async getZWaveSettings(): Promise<Setting[]> {
        const node = this.instance.getNodeUnsafe();
        return [
            {
                group: 'Info',
                title: 'Device Info',
                key: 'zwave:deviceInfo',
                readonly: true,
                value: node.deviceDatabaseUrl,
            },
            {
                group: 'Info',
                title: 'ID',
                key: 'zwave:nodeId',
                readonly: true,
                value: node.id,
            },
            {
                group: 'Info',
                title: 'Status',
                key: 'zwave:nodeStatus',
                readonly: true,
                value: NodeStatus[node.status],
            },
            {
                group: 'Info',
                title: 'Interview Stage',
                key: 'zwave:interviewStage',
                readonly: true,
                value: InterviewStage[node.interviewStage],
            },
            {
                group: 'Info',
                title: 'Device Class',
                key: 'zwave:deviceClass',
                readonly: true,
                value: node.deviceClass.specific.label,
            },
            {
                group: 'Info',
                title: 'ZWave+ Role Type',
                key: 'zwave:roleType',
                readonly: true,
                value: ZWavePlusRoleType[node.zwavePlusRoleType] || "n/a",
            },
            {
                group: 'Info',
                title: 'Firmware',
                key: 'zwave:firmware',
                readonly: true,
                value: node.firmwareVersion,
            },
            {
                group: 'Info',
                title: 'Force Remove Node',
                key: 'zwave:forceRemove',
                placeholder: `Confirm Node ID to remove: ${this.instance.nodeId}`,
                value: '',
            },
            {
                group: 'Info',
                title: 'Refresh Info',
                key: 'zwave:refreshInfo',
                type: 'button',
                description: 'Resets (almost) all information about this node and forces a fresh interview.'
            },
            {
                group: 'Statistics',
                title: 'Commands (RX/TX)',
                key: 'zwave:commands',
                readonly: true,
                value: this.statistics ? `${this.statistics.commandsRX} / ${this.statistics.commandsTX}` : 'n/a',
            },
            {
                group: 'Statistics',
                title: 'Commands Dropped (RX/TX)',
                key: 'zwave:commandsDropped',
                readonly: true,
                value: this.statistics ? `${this.statistics.commandsDroppedRX} / ${this.statistics.commandsDroppedTX}` : 'n/a',
            },
        ];
    }

    async putZWaveSetting(key: string, value: string | number | boolean): Promise<void> {
        if (key === 'zwave:forceRemove' && value === this.instance.nodeId.toString()) {
            this.zwaveController.controller.removeFailedNode(this.instance.nodeId);
            deviceManager.onDeviceRemoved(this.nativeId);
        }
        if (key === 'zwave:refreshInfo') {
            this.console.log(`[${this.name}] Refreshing Info`)
            if (!this.instance.getNodeUnsafe().ready) {
                this.console.log(`${this.name} Refresh failed, device not ready`);
                return
            }
            this.instance.getNodeUnsafe().refreshInfo().then((r) => {
                this.console.log(`[${this.name}] Refresh Completed`)
            })
        }
    }
}
