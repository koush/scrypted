import sdk ,{ ScryptedDeviceBase, ScryptedDeviceType } from "@scrypted/sdk";
import { ScriptDeviceImpl, scryptedEval as scryptedEvalBase } from "@scrypted/common/src/eval/scrypted-eval";

const util = require("!!raw-loader!./api/util.ts").default;
const libs = {
    util: util.replace('export', ''),
};

export async function scryptedEval(device: ScryptedDeviceBase, script: string, params: { [name: string]: any }) {
    return scryptedEvalBase(device, script, libs, params);
}

export class ScriptableDeviceBase extends ScryptedDeviceBase implements ScriptDeviceImpl {
    constructor(nativeId: string, public providerNativeId: string) {
        super (nativeId);
    }

    // will be done at runtime
    mergeHandler(device: ScryptedDeviceBase): string[] {
        throw new Error("Method not implemented.");
    }
    handle<T>(handler?: T & object): void {
        throw new Error("Method not implemented.");
    }
    handleTypes(...interfaces: string[]): void {
        throw new Error("Method not implemented.");
    }

    async postRunScript(defaultExport: any) {
        if (defaultExport) {
            let deviceInstance = defaultExport;
            // support exporting a plugin class, plugin main function,
            // or a plugin instance
            if (deviceInstance.toString().startsWith('class '))
                deviceInstance = new deviceInstance(this.nativeId);
            if (typeof deviceInstance === 'function')
                deviceInstance = await deviceInstance();
            this.handle(deviceInstance);
        }
    
        const allInterfaces = this.mergeHandler(this);
        if (allInterfaces.length !== 2) {
            await sdk.deviceManager.onDeviceDiscovered({
                providerNativeId: this.providerNativeId,
                nativeId: this.nativeId,
                interfaces: allInterfaces,
                type: ScryptedDeviceType.Unknown,
                name: this.providedName,
            });
        }
    }
}
