import { createMonacoEvalDefaults } from "../../../common/src/scrypted-eval";

const libs = {
    types: require("!!raw-loader!@scrypted/sdk/types.d.ts"),
    sdk: require("!!raw-loader!@scrypted/sdk/index.d.ts"),
    client: require("!!raw-loader!./api/mqtt-client.ts"),
    frigate: require("!!raw-loader!./api/frigate.ts"),
    util: require("!!raw-loader!./api/util.ts"),
};

export const monacoEvalDefaults = createMonacoEvalDefaults(libs);
