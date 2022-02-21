import { ScryptedDeviceBase } from "@scrypted/sdk";
import { scryptedEval as scryptedEvalBase } from "@scrypted/common/src/scrypted-eval";

export async function scryptedEval(device: ScryptedDeviceBase, script: string, params: { [name: string]: any }) {
    return scryptedEvalBase(device, script, {}, params);
}
