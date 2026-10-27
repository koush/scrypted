import sdk, { Readme, ScryptedDeviceBase, Setting, SettingValue, Settings } from '@scrypted/sdk';

export const OIDCNativeId = 'oidc';

const ENV_OVERRIDES: Record<string, string> = {
    discoveryUrl: 'SCRYPTED_OIDC_DISCOVERY_URL',
    clientId: 'SCRYPTED_OIDC_CLIENT_ID',
    clientSecret: 'SCRYPTED_OIDC_CLIENT_SECRET',
    roleClaim: 'SCRYPTED_OIDC_ROLE_CLAIM',
    adminRoleValue: 'SCRYPTED_OIDC_ADMIN_ROLE_VALUE',
    authType: 'SCRYPTED_AUTH_TYPE',
    redirectUri: 'SCRYPTED_OIDC_REDIRECT_URI',
};

const SETTING_DEFS: Setting[] = [
    {
        key: 'discoveryUrl',
        title: 'Discovery URL',
        description: 'The OIDC provider well-known configuration URL.',
        type: 'string',
        group: 'OIDC',
    },
    {
        key: 'clientId',
        title: 'Client ID',
        type: 'string',
        group: 'OIDC',
    },
    {
        key: 'clientSecret',
        title: 'Client Secret',
        type: 'password',
        group: 'OIDC',
    },
    {
        key: 'roleClaim',
        title: 'Role Claim',
        description: 'JWT claim that carries the user role.',
        type: 'string',
        group: 'Claims',
    },
    {
        key: 'adminRoleValue',
        title: 'Admin Role Value',
        description: 'The role claim value that grants admin access.',
        type: 'string',
        group: 'Claims',
    },
    {
        key: 'authType',
        title: 'Auth Type',
        description: 'Controls which login methods are enabled. Override with SCRYPTED_AUTH_TYPE env var.',
        type: 'string',
        choices: ['basic', 'oidc', 'basic,oidc'],
        group: 'Advanced',
    },
    {
        key: 'redirectUri',
        title: 'Redirect URI',
        description: 'Override the OIDC callback URL registered with your provider. Use when behind a reverse proxy.',
        type: 'string',
        group: 'Advanced',
    },
];

export class OIDCCore extends ScryptedDeviceBase implements Settings, Readme {
    constructor() {
        super(OIDCNativeId);
    }

    async getReadmeMarkdown(): Promise<string> {
        return 'Configure OpenID Connect (OIDC) authentication for Scrypted.';
    }

    async getSettings(): Promise<Setting[]> {
        const oidcService = await sdk.systemManager.getComponent('oidc');
        const config: Record<string, any> = await oidcService.getConfig().catch(() => undefined) ?? {};

        return SETTING_DEFS.map(def => {
            const envVar = ENV_OVERRIDES[def.key!];
            const envValue = envVar ? process.env[envVar] : undefined;
            const value = envValue ?? config[def.key!];
            return {
                ...def,
                value,
                readonly: true,
            };
        });
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
    }
}
