import { ScryptedDeviceBase, Device, Refresh } from "@scrypted/sdk";
import {getHash} from "../Types";
import { CommandClassInfo, getCommandClassIndex, getCommandClass } from ".";
import { ZwaveControllerProvider, NodeLiveness } from "../main";
import { Endpoint, ValueID, ZWaveController, ZWaveNode, ZWaveNodeValueUpdatedArgs } from "zwave-js";
import { CommandClasses, ValueMetadataNumeric } from "@zwave-js/core"

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

export class ZwaveDeviceBase extends ScryptedDeviceBase implements Refresh {
    instance: Endpoint;
    device: Device;
    commandClasses: CommandClassInfo[] = [];
    zwaveController: ZwaveControllerProvider;
    transientState: TransientState = {};

    constructor(controller: ZWaveController, instance: Endpoint) {
        super(getHash(controller, instance));
        this.instance = instance;
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
}
