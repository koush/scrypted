import { ScryptedDeviceBase } from "@scrypted/sdk";
import { scryptedEval as scryptedEvalBase } from "../../../common/src/scrypted-eval";

const util = require("!!raw-loader!./api/util.ts");
const frigate = require("!!raw-loader!./api/frigate.ts");
const libs = {
    frigate,
    util,
};

export async function scryptedEval(device: ScryptedDeviceBase, script: string, params: { [name: string]: any }) {
    return scryptedEvalBase(device, script, libs, params);
}
