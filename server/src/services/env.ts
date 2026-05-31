import fs from 'fs';
import path from 'path';
import { getScryptedVolume } from '../plugin/plugin-volume';

export function getDotEnvPath() {
    return path.join(getScryptedVolume(), '.env')
}

export class EnvControl {
    async setDotEnv(env: string) {
        await fs.promises.writeFile(getDotEnvPath(), env, 'utf8');
    }

    getDotEnv() {
        return fs.promises.readFile(getDotEnvPath(), 'utf8');
    }
}
