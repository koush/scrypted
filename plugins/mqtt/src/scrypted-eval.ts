import { ScryptedDeviceBase } from "@scrypted/sdk";
import { scryptedEval as scryptedEvalBase } from "@scrypted/common/src/eval/scrypted-eval";

const util = require("!!raw-loader!./api/util.ts").default;
const frigate = require("!!raw-loader!./api/frigate.ts").default;
const libs = {
    frigate,
    util,
};

export async function scryptedEval(device: ScryptedDeviceBase, script: string, params: { [name: string]: any }) {
    return scryptedEvalBase(device, script, libs, params);
}
