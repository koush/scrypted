import { EventEmitter } from 'events';
import axios, { AxiosRequestConfig, Method, ResponseType } from 'axios';
import https from 'https';
import WS from 'ws';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export const CONNECTION_MODE_LOCAL_USER = 'Local User';
export const CONNECTION_MODE_API_KEY_ONLY = 'API Key Only';

const INTEGRATION_PREFIX = '/proxy/protect/integration/v1';
const QUALITY_ORDER = ['high', 'medium', 'low', 'package'];
// UniFi Protect public Integration API rate limit: 10 requests / 1000ms.
const PUBLIC_API_RATE_LIMIT = 10;
const PUBLIC_API_RATE_WINDOW_MS = 1000;
const PUBLIC_API_MAX_RETRIES = 4;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface PublicCameraFeatureFlags {
    supportFullHdSnapshot?: boolean;
    hasHdr?: boolean;
    smartDetectTypes?: string[];
    smartDetectAudioTypes?: string[];
    videoModes?: string[];
    hasMic?: boolean;
    hasLedStatus?: boolean;
    hasSpeaker?: boolean;
}

export interface PublicCamera {
    id: string;
    modelKey?: string;
    state?: string;
    name?: string;
    type?: string;
    guid?: string;
    mac?: string;
    isMicEnabled?: boolean;
    ledSettings?: {
        isEnabled?: boolean;
        welcomeLed?: boolean | null;
        floodLed?: boolean | null;
    };
    lcdMessage?: {
        type?: string;
        resetAt?: number | null;
        text?: string;
    } | null;
    featureFlags?: PublicCameraFeatureFlags;
    smartDetectSettings?: {
        objectTypes?: string[];
        audioTypes?: string[];
    };
    hasPackageCamera?: boolean;
    rtspsStreams?: Record<string, string | null | undefined>;
}

export interface PublicLight {
    id: string;
    modelKey?: string;
    state?: string;
    name?: string;
    type?: string;
    guid?: string;
    mac?: string;
    lightModeSettings?: {
        mode?: string;
        enableAt?: string;
    };
    lightDeviceSettings?: {
        isIndicatorEnabled?: boolean;
        pirDuration?: number | null;
        pirSensitivity?: number | null;
        ledLevel?: number | null;
    };
    isDark?: boolean;
    isLightOn?: boolean;
    isLightForceEnabled?: boolean;
    lastMotion?: number | null;
    isPirMotionDetected?: boolean;
    camera?: string | null;
}

export interface PublicBootstrap {
    cameras: any[];
    lights: any[];
    sensors: any[];
    doorlocks: any[];
    nvr?: { id?: string; name?: string; mac?: string };
    meta?: { applicationVersion?: string };
}

export interface PublicEventItem {
    id?: string;
    modelKey?: string;
    type?: string;
    start?: number;
    end?: number;
    device?: string;
    camera?: string;
    smartDetectTypes?: string[];
    score?: number;
    metadata?: any;
}

export interface PublicWsMessage {
    type: 'add' | 'update' | 'remove' | string;
    item: PublicEventItem & Record<string, any>;
}

function extractRtspAlias(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        return parsed.pathname.replace(/^\//, '') || undefined;
    }
    catch {
        return undefined;
    }
}

function stripEnableSrtp(url: string): string {
    return url.replace(/\?enableSrtp$/, '');
}

function replaceUrlHost(url: string, host: string): string {
    try {
        const parsed = new URL(url);
        parsed.hostname = host;
        return parsed.toString();
    }
    catch {
        return url;
    }
}

function isDoorbellCamera(camera: PublicCamera): boolean {
    if (camera.ledSettings && camera.ledSettings.welcomeLed != null)
        return true;
    if (camera.lcdMessage != null)
        return true;
    return /doorbell/i.test(camera.type || '') || /doorbell/i.test(camera.name || '');
}

/**
 * Adapt a public Integration API camera into a shape close enough to the
 * private bootstrap camera for Scrypted discovery and device helpers.
 */
export function adaptPublicCamera(camera: PublicCamera, connectionHost?: string): any {
    const streams = camera.rtspsStreams || {};
    const qualities = [
        ...QUALITY_ORDER.filter(q => q in streams),
        ...Object.keys(streams).filter(q => !QUALITY_ORDER.includes(q)),
    ];

    const channels = qualities.map((quality, index) => {
        const rawUrl = streams[quality];
        const url = typeof rawUrl === 'string' ? stripEnableSrtp(rawUrl) : undefined;
        const rewritten = url && connectionHost ? replaceUrlHost(url, connectionHost) : url;
        return {
            id: quality,
            name: quality,
            enabled: !!rewritten,
            isRtspEnabled: !!rewritten,
            rtspAlias: rewritten ? extractRtspAlias(rewritten) : undefined,
            rtspsUrl: rewritten,
            width: 0,
            height: 0,
            fps: 0,
            bitrate: 0,
            minBitrate: 0,
            maxBitrate: 0,
            idrInterval: 4,
            _quality: quality,
            _index: index,
        };
    }).filter(channel => channel.rtspsUrl);

    const doorbell = isDoorbellCamera(camera);

    return {
        ...camera,
        isAdopted: true,
        isAdoptedByOther: false,
        isConnected: camera.state === 'CONNECTED',
        isMotionDetected: false,
        host: connectionHost,
        connectionHost,
        videoCodec: 'h264',
        channels,
        featureFlags: {
            supportFullHdSnapshot: !!camera.featureFlags?.supportFullHdSnapshot,
            hasHdr: !!camera.featureFlags?.hasHdr,
            smartDetectTypes: camera.featureFlags?.smartDetectTypes || [],
            smartDetectAudioTypes: camera.featureFlags?.smartDetectAudioTypes || [],
            videoModes: camera.featureFlags?.videoModes || [],
            hasMic: !!camera.featureFlags?.hasMic,
            hasLedStatus: !!camera.featureFlags?.hasLedStatus,
            hasSpeaker: !!camera.featureFlags?.hasSpeaker,
            hasPackageCamera: !!camera.hasPackageCamera,
            isDoorbell: doorbell,
            hasChime: doorbell,
            hasLcdScreen: doorbell || camera.lcdMessage != null,
            canOpticalZoom: false,
            hasFingerprintSensor: false,
        },
    };
}

export function adaptPublicLight(light: PublicLight, connectionHost?: string): any {
    return {
        ...light,
        isAdopted: true,
        isAdoptedByOther: false,
        isConnected: light.state === 'CONNECTED',
        host: connectionHost,
        // Private API naming used by existing UnifiLight helpers.
        lightOnSettings: {
            isLedForceOn: !!light.isLightForceEnabled,
        },
    };
}

export class ProtectPublicApi extends EventEmitter {
    host?: string;
    apiKey?: string;
    bootstrap: PublicBootstrap | null = null;
    headers = new Map<string, string>();
    private eventsWs?: WS;
    private devicesWs?: WS;
    private closed = false;
    private connectionHost?: string;
    private requestTimestamps: number[] = [];
    private requestChain: Promise<void> = Promise.resolve();

    constructor(private log: { debug?: (...args: any[]) => void, error?: (...args: any[]) => void, info?: (...args: any[]) => void, warn?: (...args: any[]) => void } = {}) {
        super();
    }

    get isPublicOnly() {
        return true;
    }

    private integrationUrl(path: string) {
        return `https://${this.host}${INTEGRATION_PREFIX}${path}`;
    }

    private async acquireRateLimitSlot() {
        // Serialize callers so concurrent bootstrap/stream work cannot burst past the limit.
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const previous = this.requestChain;
        this.requestChain = previous.then(() => gate, () => gate);
        await previous.catch(() => { });

        try {
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < PUBLIC_API_RATE_WINDOW_MS);
            if (this.requestTimestamps.length >= PUBLIC_API_RATE_LIMIT - 1) {
                const waitMs = PUBLIC_API_RATE_WINDOW_MS - (now - this.requestTimestamps[0]) + 25;
                if (waitMs > 0)
                    await sleep(waitMs);
                const refreshed = Date.now();
                this.requestTimestamps = this.requestTimestamps.filter(t => refreshed - t < PUBLIC_API_RATE_WINDOW_MS);
            }
            this.requestTimestamps.push(Date.now());
        }
        finally {
            release();
        }
    }

    private async request<T = any>(method: Method, path: string, options: {
        data?: any,
        responseType?: ResponseType,
        params?: Record<string, any>,
        signal?: AbortSignal,
    } = {}, attempt = 0): Promise<T> {
        if (!this.host || !this.apiKey)
            throw new Error('Public API client is not logged in.');

        await this.acquireRateLimitSlot();

        const headers: Record<string, string> = {
            'X-API-KEY': this.apiKey,
            Accept: options.responseType === 'arraybuffer' ? '*/*' : 'application/json',
        };
        if (options.data !== undefined)
            headers['Content-Type'] = 'application/json';

        const config: AxiosRequestConfig = {
            method,
            url: this.integrationUrl(path),
            headers,
            httpsAgent,
            responseType: options.responseType || 'json',
            params: options.params,
            data: options.data,
            signal: options.signal,
            validateStatus: () => true,
        };

        const response = await axios(config);
        if (response.status === 401 || response.status === 403)
            throw new Error(`Protect API key was rejected (${response.status}).`);
        if (response.status === 429) {
            if (attempt >= PUBLIC_API_MAX_RETRIES)
                throw new Error(`Protect public API ${method} ${path} failed (429): too many retries`);
            const body = response.data || {};
            const windowMs = typeof body.windowMs === 'number' ? body.windowMs : PUBLIC_API_RATE_WINDOW_MS;
            const retryAfterHeader = response.headers?.['retry-after'];
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
            const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
                ? retryAfterMs
                : windowMs + 50 * (attempt + 1);
            this.log.warn?.(`Protect public API rate limited on ${method} ${path}; retrying in ${waitMs}ms`);
            await sleep(waitMs);
            return this.request(method, path, options, attempt + 1);
        }
        if (response.status < 200 || response.status >= 300) {
            const detail = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data);
            throw new Error(`Protect public API ${method} ${path} failed (${response.status}): ${detail}`);
        }
        return response.data as T;
    }

    async login(host: string, apiKey: string): Promise<boolean> {
        this.resetSockets();
        this.host = host;
        this.apiKey = apiKey;
        this.connectionHost = host;
        this.headers = new Map([['X-API-KEY', apiKey]]);
        this.closed = false;

        try {
            const meta = await this.request<{ applicationVersion?: string }>('GET', '/meta/info');
            this.emit('login', true);
            this.log.info?.(`Connected to Protect public API ${meta?.applicationVersion || ''}`.trim());
            if (!this.bootstrap)
                this.bootstrap = { cameras: [], lights: [], sensors: [], doorlocks: [], meta };
            else
                this.bootstrap.meta = meta;
            return true;
        }
        catch (e) {
            this.emit('login', false);
            this.log.error?.('Protect public API login failed', e);
            return false;
        }
    }

    async getBootstrap(): Promise<boolean> {
        try {
            // Fetch sequentially to stay under the public API rate limit.
            const cameras = await this.request<PublicCamera[]>('GET', '/cameras');
            let lights: PublicLight[] = [];
            try {
                lights = await this.request<PublicLight[]>('GET', '/lights');
            }
            catch (e) {
                this.log.warn?.('Unable to list lights from public API', e);
            }

            const adaptedCameras = [];
            for (const camera of cameras || []) {
                try {
                    // Prefer GET-only priming during bootstrap; create streams lazily on demand.
                    camera.rtspsStreams = await this.getCameraRtspsStreams(camera.id, false);
                }
                catch (e) {
                    this.log.warn?.(`Unable to prime RTSPS streams for camera ${camera.name || camera.id}`, e);
                    camera.rtspsStreams = camera.rtspsStreams || {};
                }
                adaptedCameras.push(adaptPublicCamera(camera, this.connectionHost));
            }

            this.bootstrap = {
                cameras: adaptedCameras,
                lights: (lights || []).map(light => adaptPublicLight(light, this.connectionHost)),
                sensors: [],
                doorlocks: [],
                meta: this.bootstrap?.meta,
            };

            this.emit('bootstrap', this.bootstrap);
            this.connectWebsockets();
            return true;
        }
        catch (e) {
            this.log.error?.('Protect public API bootstrap failed', e);
            return false;
        }
    }

    async getCameraRtspsStreams(cameraId: string, createIfMissing = true): Promise<Record<string, string | null | undefined>> {
        try {
            const existing = await this.request<Record<string, string | null | undefined>>('GET', `/cameras/${cameraId}/rtsps-stream`);
            const active = Object.entries(existing || {}).filter(([, url]) => typeof url === 'string' && !!url);
            if (active.length || !createIfMissing)
                return existing || {};
        }
        catch (e) {
            this.log.debug?.('GET rtsps-stream failed, will try create', e);
            if (!createIfMissing)
                return {};
        }

        // Create common qualities when none are active yet.
        try {
            return await this.request<Record<string, string | null | undefined>>('POST', `/cameras/${cameraId}/rtsps-stream`, {
                data: { qualities: ['high', 'medium', 'low', 'package'] },
            });
        }
        catch (e) {
            this.log.debug?.('POST rtsps-stream failed', e);
            return {};
        }
    }

    async getSnapshot(cameraId: string, highQuality = true, signal?: AbortSignal): Promise<Buffer> {
        try {
            const data = await this.request<ArrayBuffer>('GET', `/cameras/${cameraId}/snapshot`, {
                params: { highQuality },
                responseType: 'arraybuffer',
                signal,
            });
            return Buffer.from(data);
        }
        catch (e) {
            if (highQuality) {
                // Some cameras reject highQuality=true; fall back to low-res.
                const data = await this.request<ArrayBuffer>('GET', `/cameras/${cameraId}/snapshot`, {
                    params: { highQuality: false },
                    responseType: 'arraybuffer',
                    signal,
                });
                return Buffer.from(data);
            }
            throw e;
        }
    }

    async updateDevice(device: { id: string, modelKey?: string }, payload: Record<string, any>): Promise<any> {
        const modelKey = device.modelKey || (this.bootstrap?.lights?.find(l => l.id === device.id) ? 'light' : 'camera');
        if (modelKey === 'light') {
            const body: Record<string, any> = {};
            if (payload.lightOnSettings?.isLedForceOn != null)
                body.isLightForceEnabled = !!payload.lightOnSettings.isLedForceOn;
            if (payload.isLightForceEnabled != null)
                body.isLightForceEnabled = !!payload.isLightForceEnabled;
            if (payload.lightDeviceSettings)
                body.lightDeviceSettings = payload.lightDeviceSettings;
            if (payload.name != null)
                body.name = payload.name;

            const updated = await this.request<PublicLight>('PATCH', `/lights/${device.id}`, { data: body });
            const adapted = adaptPublicLight(updated, this.connectionHost);
            if (this.bootstrap) {
                const idx = this.bootstrap.lights.findIndex(l => l.id === device.id);
                if (idx >= 0)
                    this.bootstrap.lights[idx] = { ...this.bootstrap.lights[idx], ...adapted };
            }
            return adapted;
        }

        const body: Record<string, any> = { ...payload };
        // Private-only fields are not valid on the public camera PATCH.
        delete body.channels;
        delete body.privacyZones;
        delete body.ispSettings;

        const updated = await this.request<PublicCamera>('PATCH', `/cameras/${device.id}`, { data: body });
        const existing = this.bootstrap?.cameras?.find(c => c.id === device.id);
        const adapted = adaptPublicCamera({
            ...updated,
            rtspsStreams: existing?.rtspsStreams || updated.rtspsStreams,
        }, this.connectionHost);
        if (this.bootstrap) {
            const idx = this.bootstrap.cameras.findIndex(c => c.id === device.id);
            if (idx >= 0)
                this.bootstrap.cameras[idx] = { ...this.bootstrap.cameras[idx], ...adapted };
        }
        return adapted;
    }

    getApiEndpoint(endpoint: string): string {
        if (endpoint === 'websocket')
            return `https://${this.host}${INTEGRATION_PREFIX}`;
        return this.integrationUrl('');
    }

    private connectWebsockets() {
        this.resetSockets();
        if (!this.host || !this.apiKey || this.closed)
            return;

        const headers = { 'X-API-KEY': this.apiKey };

        this.eventsWs = new WS(`wss://${this.host}${INTEGRATION_PREFIX}/subscribe/events`, {
            rejectUnauthorized: false,
            headers,
        });
        this.eventsWs.on('open', () => this.log.debug?.('Public events websocket connected'));
        this.eventsWs.on('message', data => this.handleWsMessage('event', data));
        this.eventsWs.on('close', () => {
            this.log.debug?.('Public events websocket closed');
            this.emit('websocket-close', 'events');
        });
        this.eventsWs.on('error', e => this.log.error?.('Public events websocket error', e));

        this.devicesWs = new WS(`wss://${this.host}${INTEGRATION_PREFIX}/subscribe/devices`, {
            rejectUnauthorized: false,
            headers,
        });
        this.devicesWs.on('open', () => this.log.debug?.('Public devices websocket connected'));
        this.devicesWs.on('message', data => this.handleWsMessage('device', data));
        this.devicesWs.on('close', () => {
            this.log.debug?.('Public devices websocket closed');
            this.emit('websocket-close', 'devices');
        });
        this.devicesWs.on('error', e => this.log.error?.('Public devices websocket error', e));
    }

    private handleWsMessage(kind: 'event' | 'device', data: WS.RawData) {
        try {
            const text = typeof data === 'string' ? data : data.toString();
            const parsed = JSON.parse(text) as PublicWsMessage | PublicWsMessage[];
            const messages = Array.isArray(parsed) ? parsed : [parsed];
            for (const message of messages) {
                if (!message?.type || !message?.item)
                    continue;
                // Bulk device envelopes may carry an id array with a shared payload.
                const ids = message.item.id;
                if (kind === 'device' && Array.isArray(ids)) {
                    for (const id of ids) {
                        const single = { type: message.type, item: { ...message.item, id } };
                        this.emit('public-device', single);
                        this.emit('message', this.toPrivateStylePacket(kind, single));
                    }
                    continue;
                }
                if (kind === 'event')
                    this.emit('public-event', message);
                else
                    this.emit('public-device', message);
                // Also emit a private-style packet for shared listeners where possible.
                this.emit('message', this.toPrivateStylePacket(kind, message));
            }
        }
        catch (e) {
            this.log.debug?.('Failed to parse public websocket message', e);
        }
    }

    private toPrivateStylePacket(kind: 'event' | 'device', message: PublicWsMessage) {
        const item = message.item || {};
        if (kind === 'event' || item.modelKey === 'event') {
            return {
                header: {
                    action: message.type === 'add' ? 'add' : 'update',
                    modelKey: 'event',
                    id: item.id,
                },
                payload: {
                    ...item,
                    // Private event payloads use `camera`; public uses `device`.
                    camera: item.camera || item.device,
                },
            };
        }

        return {
            header: {
                action: message.type === 'add' ? 'add' : (message.type === 'remove' ? 'remove' : 'update'),
                modelKey: item.modelKey,
                id: item.id,
            },
            payload: item,
        };
    }

    private safeCloseSocket(ws?: WS) {
        if (!ws)
            return;
        // Closing a CONNECTING socket emits an 'error' event. With no listener,
        // Node treats that as an uncaughtException and crashes the plugin.
        ws.removeAllListeners();
        ws.on('error', () => { });
        try {
            if (ws.readyState === WS.CONNECTING || ws.readyState === WS.CLOSING)
                ws.terminate();
            else if (ws.readyState === WS.OPEN)
                ws.close();
            else
                ws.terminate();
        }
        catch { }
    }

    private resetSockets() {
        this.safeCloseSocket(this.eventsWs);
        this.safeCloseSocket(this.devicesWs);
        this.eventsWs = undefined;
        this.devicesWs = undefined;
    }

    reset() {
        this.closed = true;
        this.resetSockets();
        this.bootstrap = null;
        this.headers = new Map();
        this.requestTimestamps = [];
    }

    logout() {
        this.reset();
        this.host = undefined;
        this.apiKey = undefined;
    }
}
