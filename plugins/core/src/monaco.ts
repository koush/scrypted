import { createMonacoEvalDefaults } from "../../../common/src/eval/scrypted-eval";

const libs = {
    script: require("!!raw-loader!@scrypted/common/src/eval/monaco/script-device.ts").default,
    util: require("!!raw-loader!./api/util.ts").default,
};

export const monacoEvalDefaults = createMonacoEvalDefaults(libs);
