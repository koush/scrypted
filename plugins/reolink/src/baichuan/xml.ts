import { parseStringPromise } from 'xml2js';

/**
 * Wraps a top-level payload (LoginUser/LoginNet, TalkConfig, ...) in the
 * `<?xml?><body>...</body>` envelope Baichuan expects for the main message
 * payload.
 *
 * IMPORTANT: the small `<Extension>` block that precedes the payload in
 * most requests is NOT wrapped this way - it is sent as a bare fragment.
 * Wrapping the Extension in `<body>` too was tried live and the device
 * rejects the request outright (response code 421, "extension xml parse
 * failed") because its Extension-specific parser expects the fragment to
 * start directly with `<Extension>`. Use `buildExtensionXml` for that case.
 */
export function buildBodyXml(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8" ?>\n<body>\n${inner}\n</body>`;
}

export interface ExtensionOptions {
    channelId: number;
    /** Set when the payload that follows the extension is raw binary (e.g.
     * an ADPCM Talk block) rather than XML. */
    binaryData?: boolean;
}

/** Builds the bare `<Extension>` fragment - see the warning on `buildBodyXml`. */
export function buildExtensionXml(options: ExtensionOptions): string {
    const binaryDataTag = options.binaryData ? '\n<binaryData>1</binaryData>' : '';
    return `<Extension version="1.1">\n<channelId>${options.channelId}</channelId>${binaryDataTag}\n</Extension>`;
}

export function buildLoginXml(username: string, password: string): string {
    return buildBodyXml(
        '<LoginUser version="1.1">\n' +
        `<userName>${username}</userName>\n` +
        `<password>${password}</password>\n` +
        '<userVer>1</userVer>\n' +
        '</LoginUser>\n' +
        '<LoginNet version="1.1">\n' +
        '<type>LAN</type>\n' +
        '<udpPort>0</udpPort>\n' +
        '</LoginNet>',
    );
}

export interface TalkAudioConfig {
    audioType: string;
    sampleRate: number;
    samplePrecision: number;
    lengthPerEncoder: number;
    soundTrack: string;
}

export interface TalkAbility {
    duplexOptions: string[];
    audioStreamModeOptions: string[];
    audioConfigOptions: TalkAudioConfig[];
}

export function buildTalkConfigXml(channelId: number, duplex: string, audioStreamMode: string, audioConfig: TalkAudioConfig): string {
    return buildBodyXml(
        '<TalkConfig version="1.1">\n' +
        `<channelId>${channelId}</channelId>\n` +
        `<duplex>${duplex}</duplex>\n` +
        `<audioStreamMode>${audioStreamMode}</audioStreamMode>\n` +
        '<audioConfig>\n' +
        `<audioType>${audioConfig.audioType}</audioType>\n` +
        `<sampleRate>${audioConfig.sampleRate}</sampleRate>\n` +
        `<samplePrecision>${audioConfig.samplePrecision}</samplePrecision>\n` +
        `<lengthPerEncoder>${audioConfig.lengthPerEncoder}</lengthPerEncoder>\n` +
        `<soundTrack>${audioConfig.soundTrack}</soundTrack>\n` +
        '</audioConfig>\n' +
        '</TalkConfig>',
    );
}

/** Extracts the login nonce from the `<Encryption><nonce>...</nonce></Encryption>` reply. */
export function parseNonce(xml: string): string {
    const match = /<nonce>([^<]+)<\/nonce>/.exec(xml);
    if (!match)
        throw new Error(`no <nonce> found in login reply: ${xml}`);
    return match[1];
}

export async function parseTalkAbility(xml: string): Promise<TalkAbility> {
    const parsed = await parseStringPromise(xml);
    const ability = parsed?.body?.TalkAbility?.[0];
    if (!ability)
        throw new Error(`no <TalkAbility> found in reply: ${xml}`);

    const duplexOptions: string[] = (ability.duplexList?.[0]?.duplex ?? []) as string[];
    const audioStreamModeOptions: string[] = (ability.audioStreamModeList?.[0]?.audioStreamMode ?? []) as string[];
    const audioConfigOptions: TalkAudioConfig[] = ((ability.audioConfigList?.[0]?.audioConfig ?? []) as any[]).map(cfg => ({
        audioType: cfg.audioType?.[0],
        sampleRate: Number(cfg.sampleRate?.[0]),
        samplePrecision: Number(cfg.samplePrecision?.[0]),
        lengthPerEncoder: Number(cfg.lengthPerEncoder?.[0]),
        soundTrack: cfg.soundTrack?.[0],
    }));

    return { duplexOptions, audioStreamModeOptions, audioConfigOptions };
}
