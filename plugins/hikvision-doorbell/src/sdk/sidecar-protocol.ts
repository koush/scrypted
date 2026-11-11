/** One line of the HCNetSDK sidecar's stdout (see fs/hcnetsdk_sidecar.py). */
export type SidecarMessage =
    | { type: 'ready', sdkVersion: string }
    | { type: 'ring' }
    | { type: 'end' }
    | { type: 'error', stage: 'init' | 'login' | 'arm', code: number, message: string }
    | { type: 'disconnected' }
    | { type: 'reconnected' }
    | { type: 'raw', source: 'alarm' | 'call' | 'exception', command: number, data: Record<string, unknown> };

const ERROR_STAGES = ['init', 'login', 'arm'];
const RAW_SOURCES = ['alarm', 'call', 'exception'];

/** Returns undefined for anything that is not a well-formed protocol message (the SDK also prints noise). */
export function parseSidecarLine (line: string): SidecarMessage | undefined
{
    let m: any;
    try {
        m = JSON.parse (line);
    }
    catch {
        return undefined;
    }
    if (!m || typeof m !== 'object') {
        return undefined;
    }
    switch (m.type) {
        case 'ring':
        case 'end':
        case 'disconnected':
        case 'reconnected':
            return { type: m.type };
        case 'ready':
            return typeof m.sdkVersion === 'string' ? { type: 'ready', sdkVersion: m.sdkVersion } : undefined;
        case 'error':
            return ERROR_STAGES.includes (m.stage) && typeof m.code === 'number' && typeof m.message === 'string'
                ? { type: 'error', stage: m.stage, code: m.code, message: m.message }
                : undefined;
        case 'raw':
            return RAW_SOURCES.includes (m.source) && typeof m.command === 'number' && m.data && typeof m.data === 'object'
                ? { type: 'raw', source: m.source, command: m.command, data: m.data }
                : undefined;
        default:
            return undefined;
    }
}
