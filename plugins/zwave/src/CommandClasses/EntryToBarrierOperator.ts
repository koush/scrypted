import { Entry } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { BarrierState } from "zwave-js";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class EntryToBarrierOperator extends ZwaveDeviceBase implements Entry {
    async closeEntry(): Promise<void> {
        const cc = this.instance.commandClasses['Barrier Operator'];
        await cc.set(BarrierState.Closed);
        this.entryOpen = (await cc.get()).currentState !== BarrierState.Closed;
    }
    async openEntry(): Promise<void> {
        const cc = this.instance.commandClasses['Barrier Operator'];
        await cc.set(BarrierState.Open);
        this.entryOpen = (await cc.get()).currentState !== BarrierState.Closed;
    }
    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.entryOpen = zwaveDevice.getValue(valueId) !== BarrierState.Closed;
    }
}

export default EntryToBarrierOperator;
