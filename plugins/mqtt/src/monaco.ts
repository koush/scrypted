import { createMonacoEvalDefaults } from "@scrypted/common/src/eval/scrypted-eval";

const libs = {
    '@types/scrypted/common/script-device.d.ts': require("!!raw-loader!@scrypted/common/src/eval/monaco/script-device.ts").default,
    '@types/scrypted/mqtt/mqtt-client.d.ts': require("!!raw-loader!./api/mqtt-client.ts").default,
    '@types/scrypted/mqtt/util.d.ts': require("!!raw-loader!./api/util.ts").default,
};

export const monacoEvalDefaults = createMonacoEvalDefaults(libs);
