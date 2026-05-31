export const serverVersion = require('../../package.json').version;

export class Info {
    async getVersion() {
        return require('../../package.json').version;
    }

    async getScryptedEnv() {
        const ret: NodeJS.ProcessEnv = {};
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('SCRYPTED_'))
                ret[key] = process.env[key];
        }
        return ret;
    }
}
