import sdk from '@scrypted/sdk';
import packageJson from "../package.json";
import { getScryptedServerAddresses } from './address-override';
import type { HomeKitPlugin } from "./main";
import { getDebugMode } from './types/camera/camera-debug-mode-storage';
import { getHksvClipStorageStats } from './types/camera/camera-recording-files';

const { deviceManager, systemManager } = sdk;

export interface StreamSessionDiag {
    sessionId: string;
    deviceId: string;
    deviceName?: string;
    targetAddress?: string;
    sourceAddress?: string;
    startedAt: number;
    negotiatedVideoCodec?: string;
    negotiatedAudioCodec?: string;
}

export interface RtcpTimeoutDiag {
    deviceId: string;
    deviceName?: string;
    at: number;
}

export interface SnapshotDiag {
    deviceId: string;
    deviceName?: string;
    at: number;
    status: 'success' | 'error';
    reason?: string;
    width?: number;
    height?: number;
}

export interface RecordingSessionDiag {
    key: string;
    deviceId: string;
    deviceName?: string;
    startedAt: number;
    fragments: number;
    fragmentBytes: number;
    lastFragmentAt?: number;
    path: 'direct-tcp' | 'ffmpeg';
    negotiatedVideoCodec?: string;
    negotiatedAudioCodec?: string;
    firstFragmentKeyframe?: boolean | 'unknown';
    saveRecordings: boolean;
    ffmpegWarnings: string[];
}

export interface RecordingResultDiag extends RecordingSessionDiag {
    durationMs: number;
    endedAt: number;
    error?: string;
}

export interface BridgePublishDiag {
    state: 'pending' | 'published' | 'error';
    at: number;
    error?: string;
}

export interface DiagnosticsState {
    bridgePublish: BridgePublishDiag;
    activeStreamSessions: Map<string, StreamSessionDiag>;
    lastRtcpTimeout?: RtcpTimeoutDiag;
    lastSnapshotByDevice: Map<string, SnapshotDiag>;
    activeRecordingSessions: Map<string, RecordingSessionDiag>;
    lastRecordingResult?: RecordingResultDiag;
    completedRecordingCount: number;
}

export function createDiagnosticsState(): DiagnosticsState {
    return {
        bridgePublish: {
            state: 'pending',
            at: Date.now(),
        },
        activeStreamSessions: new Map(),
        lastSnapshotByDevice: new Map(),
        activeRecordingSessions: new Map(),
        completedRecordingCount: 0,
    };
}

function formatTime(time: number) {
    if (!time)
        return 'unknown';
    return new Date(time).toISOString();
}

function formatDuration(ms: number) {
    if (ms === undefined || ms === null)
        return 'unknown';
    return `${Math.round(ms / 1000)}s`;
}

function formatBytes(bytes: number) {
    if (bytes === undefined || bytes === null)
        return 'unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

function valueOrUnknown(value: any) {
    if (value === undefined || value === null || value === '')
        return 'unknown';
    return value;
}

function appendSection(lines: string[], title: string) {
    if (lines.length)
        lines.push('');
    lines.push(`${title}:`);
}

function appendMap<T>(lines: string[], entries: Iterable<T>, formatter: (entry: T) => string) {
    let count = 0;
    for (const entry of entries) {
        lines.push(`- ${formatter(entry)}`);
        count++;
    }
    if (!count)
        lines.push('- none');
}

function appendFfmpegWarnings(lines: string[], warnings: string[]) {
    if (!warnings?.length)
        return;
    lines.push('  FFmpeg warnings:');
    for (const warning of warnings) {
        lines.push(`  - ${warning}`);
    }
}

function getDeviceName(id: string) {
    try {
        return systemManager.getDeviceById(id)?.name;
    }
    catch (e) {
    }
}

function getAccessoryIdentitySummary(plugin: HomeKitPlugin, id: string, standalone: boolean) {
    try {
        const storage = deviceManager.getMixinStorage(id, plugin.nativeId);
        const mac = storage.getItem('mac');
        const resetAccessory = storage.getItem('resetAccessory');
        if (standalone)
            return `${getDeviceName(id) || id}: standalone accessory, mac=${mac ? 'present' : 'missing'}, reset=${resetAccessory ? 'set' : 'unset'}`;
        return `${getDeviceName(id) || id}: bridged accessory, uses bridge identity, reset=${resetAccessory ? 'set' : 'unset'}`;
    }
    catch (e) {
        return `${getDeviceName(id) || id}: ${standalone ? 'standalone' : 'bridged'} accessory, identity=unknown`;
    }
}

function escapeHtml(text: string) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export async function buildDiagnosticsReport(plugin: HomeKitPlugin): Promise<string> {
    const lines: string[] = [];
    const state = plugin.diagnostics;

    appendSection(lines, 'Plugin');
    lines.push(`Package: ${packageJson.name}`);
    lines.push(`Version: ${packageJson.version}`);

    appendSection(lines, 'Bridge Publish');
    lines.push(`State: ${state.bridgePublish.state}`);
    lines.push(`Updated: ${formatTime(state.bridgePublish.at)}`);
    if (state.bridgePublish.error)
        lines.push(`Error: ${state.bridgePublish.error}`);

    appendSection(lines, 'Network');
    try {
        lines.push(`mDNS advertiser: ${plugin.getAdvertiser()}`);
    }
    catch (e) {
        lines.push('mDNS advertiser: unknown');
    }
    try {
        const bind = await plugin.getAdvertiserInterfaceBind();
        lines.push(`mDNS bind addresses: ${Array.isArray(bind) ? bind.join(', ') : valueOrUnknown(bind || 'all addresses')}`);
    }
    catch (e) {
        lines.push('mDNS bind addresses: unknown');
    }
    try {
        const addresses = await getScryptedServerAddresses();
        lines.push(`Scrypted server addresses: ${addresses?.length ? addresses.join(', ') : 'unknown'}`);
    }
    catch (e) {
        lines.push('Scrypted server addresses: unknown');
    }

    appendSection(lines, 'HomeKit Connections');
    appendMap(lines, plugin.seenConnections, address => address);

    appendSection(lines, 'Last Snapshot Results');
    appendMap(lines, state.lastSnapshotByDevice.values(), snapshot => {
        const name = snapshot.deviceName || snapshot.deviceId;
        if (snapshot.status === 'success')
            return `${name}: success, requested ${snapshot.width}x${snapshot.height}, at=${formatTime(snapshot.at)}`;
        return `${name}: error, ${valueOrUnknown(snapshot.reason)}, at=${formatTime(snapshot.at)}`;
    });

    appendSection(lines, 'Standalone Accessories');
    appendMap(lines, plugin.standalones, ([id]) => `${getDeviceName(id) || id} (${id})`);

    appendSection(lines, 'Active Live Streams');
    appendMap(lines, state.activeStreamSessions.values(), session => {
        const duration = Date.now() - session.startedAt;
        return `${session.deviceName || session.deviceId}: session=${session.sessionId}, target=${valueOrUnknown(session.targetAddress)}, source=${valueOrUnknown(session.sourceAddress)}, duration=${formatDuration(duration)}, video=${valueOrUnknown(session.negotiatedVideoCodec)}, audio=${valueOrUnknown(session.negotiatedAudioCodec)}`;
    });

    appendSection(lines, 'Last Live Stream RTCP Timeout');
    if (state.lastRtcpTimeout) {
        lines.push(`Device: ${state.lastRtcpTimeout.deviceName || state.lastRtcpTimeout.deviceId}`);
        lines.push(`At: ${formatTime(state.lastRtcpTimeout.at)}`);
    }
    else {
        lines.push('none');
    }

    appendSection(lines, 'Active HKSV Recordings');
    let activeRecordingCount = 0;
    for (const recording of state.activeRecordingSessions.values()) {
        const duration = Date.now() - recording.startedAt;
        lines.push(`- ${recording.deviceName || recording.deviceId}: key=${recording.key}, path=${recording.path}, fragments=${recording.fragments}, bytes=${formatBytes(recording.fragmentBytes)}, lastFragment=${formatTime(recording.lastFragmentAt)}, duration=${formatDuration(duration)}, video=${valueOrUnknown(recording.negotiatedVideoCodec)}, audio=${valueOrUnknown(recording.negotiatedAudioCodec)}, saveRecordings=${recording.saveRecordings}`);
        appendFfmpegWarnings(lines, recording.ffmpegWarnings);
        activeRecordingCount++;
    }
    if (!activeRecordingCount)
        lines.push('- none');

    appendSection(lines, 'Last Completed HKSV Recording');
    lines.push(`Completed since plugin start: ${state.completedRecordingCount}`);
    if (state.lastRecordingResult) {
        const result = state.lastRecordingResult;
        lines.push(`Device: ${result.deviceName || result.deviceId}`);
        lines.push(`Path: ${result.path}`);
        lines.push(`Fragments: ${result.fragments}`);
        lines.push(`Bytes: ${formatBytes(result.fragmentBytes)}`);
        lines.push(`Duration: ${formatDuration(result.durationMs)}`);
        lines.push(`Video: ${valueOrUnknown(result.negotiatedVideoCodec)}`);
        lines.push(`Audio: ${valueOrUnknown(result.negotiatedAudioCodec)}`);
        lines.push(`Save Recordings: ${result.saveRecordings}`);
        lines.push(`Last Fragment: ${formatTime(result.lastFragmentAt)}`);
        lines.push(`Ended: ${formatTime(result.endedAt)}`);
        appendFfmpegWarnings(lines, result.ffmpegWarnings);
        if (result.error)
            lines.push(`Error: ${result.error}`);
    }
    else {
        lines.push('Last completed: none since plugin start');
    }

    appendSection(lines, 'HKSV Debug Clips');
    try {
        const stats = await getHksvClipStorageStats();
        lines.push(`Clip count: ${stats.clipCount}`);
        lines.push(`Total size: ${formatBytes(stats.totalBytes)}`);
        lines.push(`Scanned: ${formatTime(stats.scannedAt)}`);
    }
    catch (e) {
        lines.push('Clip count: unknown');
        lines.push('Total size: unknown');
    }

    appendSection(lines, 'Save Recordings Debug Mode');
    let saveRecordingCount = 0;
    for (const cameraMixin of plugin.cameraMixins.values()) {
        try {
            const debugMode = getDebugMode(cameraMixin.storage);
            if (!debugMode.recording)
                continue;
            saveRecordingCount++;
            lines.push(`- ${cameraMixin.name || cameraMixin.id}: Save Recordings is ON`);
        }
        catch (e) {
        }
    }
    if (!saveRecordingCount)
        lines.push('- none');

    appendSection(lines, 'Accessory Identity');
    const standaloneIds = new Set(plugin.standalones.keys());
    lines.push('Standalone accessories:');
    appendMap(lines, standaloneIds, id => getAccessoryIdentitySummary(plugin, id, true));

    lines.push('Bridged camera accessories:');
    let bridgedCameraCount = 0;
    for (const cameraMixin of plugin.cameraMixins.values()) {
        if (standaloneIds.has(cameraMixin.id))
            continue;
        bridgedCameraCount++;
        lines.push(`- ${getAccessoryIdentitySummary(plugin, cameraMixin.id, false)}`);
    }
    if (!bridgedCameraCount)
        lines.push('- none');

    return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}
