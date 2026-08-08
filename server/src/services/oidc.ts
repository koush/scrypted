import { CallbackParamsType, Client, generators, Issuer } from 'openid-client';
import { Settings } from '../db-types';
import { ScryptedRuntime } from '../runtime';

export interface OIDCConfig {
    discoveryUrl: string;
    clientId: string;
    clientSecret: string;
    roleClaim: string;
    adminRoleValue: string;
    authType: string;
    redirectUri?: string;
}

const DB_KEY = 'oidc';

export class OIDCService {
    private cachedClient: Client | undefined;
    private configCache: { value: OIDCConfig | undefined } | undefined;
    private authTypeCache: string | undefined;

    constructor(public scrypted: ScryptedRuntime) { }

    async getConfig(): Promise<OIDCConfig | undefined> {
        if (this.configCache)
            return this.configCache.value;

        const setting = await this.scrypted.datastore.tryGet(Settings, DB_KEY);
        const stored: Partial<OIDCConfig> = setting?.value ?? {};

        const config: OIDCConfig = {
            discoveryUrl: process.env.SCRYPTED_OIDC_DISCOVERY_URL ?? stored.discoveryUrl ?? '',
            clientId: process.env.SCRYPTED_OIDC_CLIENT_ID ?? stored.clientId ?? '',
            clientSecret: process.env.SCRYPTED_OIDC_CLIENT_SECRET ?? stored.clientSecret ?? '',
            roleClaim: process.env.SCRYPTED_OIDC_ROLE_CLAIM ?? stored.roleClaim ?? '',
            adminRoleValue: process.env.SCRYPTED_OIDC_ADMIN_ROLE_VALUE ?? stored.adminRoleValue ?? '',
            authType: process.env.SCRYPTED_AUTH_TYPE ?? stored.authType ?? 'basic',
            redirectUri: process.env.SCRYPTED_OIDC_REDIRECT_URI ?? stored.redirectUri,
        };

        const result = (!config.discoveryUrl || !config.clientId || !config.clientSecret)
            ? undefined
            : config;

        this.configCache = { value: result };
        if (result)
            this.authTypeCache = result.authType;

        return result;
    }

    async getAuthType(): Promise<string> {
        if (this.authTypeCache !== undefined)
            return this.authTypeCache;

        const setting = await this.scrypted.datastore.tryGet(Settings, DB_KEY);
        const authType = process.env.SCRYPTED_AUTH_TYPE
            ?? (setting?.value as Partial<OIDCConfig>)?.authType
            ?? 'basic';

        this.authTypeCache = authType;
        return authType;
    }

    async getRedirectUri(fallback: string): Promise<string> {
        if (process.env.SCRYPTED_OIDC_REDIRECT_URI)
            return process.env.SCRYPTED_OIDC_REDIRECT_URI;
        const config = await this.getConfig();
        return config?.redirectUri ?? fallback;
    }

    async setConfig(config: Partial<OIDCConfig>): Promise<void> {
        const existing = await this.scrypted.datastore.tryGet(Settings, DB_KEY);
        const current: Partial<OIDCConfig> = existing?.value ?? {};
        const merged = { ...current, ...config };

        const setting = new Settings();
        setting._id = DB_KEY;
        setting.value = merged;
        await this.scrypted.datastore.upsert(setting);

        this.cachedClient = undefined;
        this.configCache = undefined;
        this.authTypeCache = undefined;
    }

    async isEnabled(): Promise<boolean> {
        const config = await this.getConfig();
        if (!config)
            return false;
        const authType = await this.getAuthType();
        return authType.split(',').map((s: string) => s.trim()).includes('oidc');
    }

    async isBasicEnabled(): Promise<boolean> {
        const authType = await this.getAuthType();
        return authType.split(',').map((s: string) => s.trim()).includes('basic');
    }

    private async getClient(config: OIDCConfig): Promise<Client> {
        if (this.cachedClient)
            return this.cachedClient;

        const issuer = await Issuer.discover(config.discoveryUrl);
        this.cachedClient = new issuer.Client({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            response_types: ['code'],
        });
        return this.cachedClient;
    }

    async getAuthorizationUrl(redirectUri: string, state: string, nonce: string): Promise<{ url: string; codeVerifier: string }> {
        const config = await this.getConfig();
        if (!config)
            throw new Error('OIDC not configured');
        const client = await this.getClient(config);
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);
        const url = client.authorizationUrl({
            redirect_uri: redirectUri,
            scope: 'openid email profile',
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        return { url, codeVerifier };
    }

    async exchangeCode(redirectUri: string, params: CallbackParamsType, checks: { state: string; nonce: string; codeVerifier: string }): Promise<{ sub: string; username: string; isAdmin: boolean }> {
        const config = await this.getConfig();
        if (!config)
            throw new Error('OIDC not configured');

        const client = await this.getClient(config);
        const tokenSet = await client.callback(redirectUri, params, { state: checks.state, nonce: checks.nonce, code_verifier: checks.codeVerifier });
        const claims = tokenSet.claims();

        const iss = claims.iss;
        const sub = `${iss}:${claims.sub}`;
        const rawUsername = typeof claims.preferred_username === 'string' ? claims.preferred_username
            : typeof claims.email === 'string' ? claims.email
            : claims.sub;
        const username = rawUsername.toLowerCase().replace(/[^a-z0-9._@-]/g, '_').slice(0, 128);

        let isAdmin = false;
        if (config.roleClaim && config.adminRoleValue) {
            const roleValue = claims[config.roleClaim];
            isAdmin = Array.isArray(roleValue)
                ? roleValue.includes(config.adminRoleValue)
                : roleValue === config.adminRoleValue;
        }

        return { sub, username, isAdmin };
    }
}
