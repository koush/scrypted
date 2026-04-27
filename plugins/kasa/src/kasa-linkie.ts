import crypto from 'crypto';
import { httpFetch } from '../../../server/src/fetch/http-fetch';
import { xorDecrypt, xorEncrypt } from './kasa-cipher';

export const KASA_LINKIE_PORT = 10443;
const KASA_LINKIE_PATH = '/data/LINKIE2.json';

// Same auth quirk as the talk channel: the camera wants md5_hex(plaintext) as the password.
// (The receive endpoint takes base64(plaintext) instead — same camera, three different
// places, three subtly different conventions.)
function md5Hex(plaintext: string): string {
    return crypto.createHash('md5').update(plaintext, 'utf8').digest('hex');
}

export interface KasaLinkieOptions {
    ip: string;
    port?: number;
    username: string;
    password: string;
}

export interface KasaLinkieClientLogger {
    warn?: Console['warn'];
}

// Speaks the Kasa "LINKIE2" control protocol used by the iOS app for everything that isn't
// streaming or talk: spotlight, siren, mic config, SD card status, etc. Wire format:
//   - HTTPS POST to https://<ip>:10443/data/LINKIE2.json
//   - Body: application/x-www-form-urlencoded `content=<base64(xor_ab(json))>`
//   - Each request body adds a `context.source` UUID — the camera ignores it but the field
//     is always present in captures, so we generate one per call.
//   - Response: same encoding, with the result merged under the same module/method keys.
export class KasaLinkieClient {
    constructor(public options: KasaLinkieOptions, public logger?: KasaLinkieClientLogger) { }

    async call(command: Record<string, any>): Promise<any> {
        const body = {
            ...command,
            context: { source: crypto.randomUUID() },
        };
        const json = JSON.stringify(body);
        const encrypted = xorEncrypt(Buffer.from(json, 'utf8'));
        const formBody = `content=${encodeURIComponent(encrypted.toString('base64'))}`;

        const url = `https://${this.options.ip}:${this.options.port || KASA_LINKIE_PORT}${KASA_LINKIE_PATH}`;
        // Send Basic auth pre-emptively. The camera does not respond at all to unauthenticated
        // requests (no 401, no anything), so the standard "wait for challenge then retry"
        // pattern would just hang. Pre-emptive auth matches what curl with `-u` does.
        const auth = 'Basic ' + Buffer.from(
            `${this.options.username}:${md5Hex(this.options.password)}`,
        ).toString('base64');

        const response = await httpFetch({
            url,
            method: 'POST',
            rejectUnauthorized: false,
            timeout: 5000,
            // Mirror the Kasa iOS app's headers — the camera gates /data/LINKIE2.json on the
            // User-Agent (silently drops requests that don't look like the Kasa app).
            headers: {
                'Authorization': auth,
                'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
                'User-Agent': 'Kasa/1752 CFNetwork/3860.500.112 Darwin/25.4.0',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
            },
            body: Buffer.from(formBody),
            responseType: 'buffer',
        });

        const respB64 = response.body.toString('utf8').trim();
        const respDecrypted = xorDecrypt(Buffer.from(respB64, 'base64'));
        return JSON.parse(respDecrypted.toString('utf8'));
    }

    // Spotlight controls under smartlife.cam.ipcamera.dayNight (called "force_lamp" at the
    // protocol level, "spotlight" in the Kasa app UI).
    // Returns 'on' / 'off' for cameras that support it, undefined for cameras that don't
    // (request fails or the module is missing from the response).

    async getForceLampState(): Promise<'on' | 'off' | undefined> {
        try {
            const r = await this.call({
                'smartlife.cam.ipcamera.dayNight': { get_force_lamp_state: {} },
            });
            const v = r?.['smartlife.cam.ipcamera.dayNight']?.get_force_lamp_state?.value;
            return v === 'on' || v === 'off' ? v : undefined;
        }
        catch (e) {
            this.logger?.warn?.('kasa linkie get_force_lamp_state failed:', (e as Error).message);
            return undefined;
        }
    }

    async setForceLampState(on: boolean): Promise<void> {
        const r = await this.call({
            'smartlife.cam.ipcamera.dayNight': {
                set_force_lamp_state: { value: on ? 'on' : 'off' },
            },
        });
        const errCode = r?.['smartlife.cam.ipcamera.dayNight']?.set_force_lamp_state?.err_code;
        if (errCode !== 0)
            throw new Error(`set_force_lamp_state err_code=${errCode}`);
    }
}
