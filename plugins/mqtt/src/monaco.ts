import { createMonacoEvalDefaults } from "../../../common/src/scrypted-eval";

const libs = {
    types: require("!!raw-loader!@scrypted/sdk/types.d.ts").default,
    sdk: require("!!raw-loader!@scrypted/sdk/index.d.ts").default,
    client: require("!!raw-loader!./api/mqtt-client.ts").default,
    frigate: require("!!raw-loader!./api/frigate.ts").default,
    util: require("!!raw-loader!./api/util.ts").default,
};

export const monacoEvalDefaults = createMonacoEvalDefaults(libs);
