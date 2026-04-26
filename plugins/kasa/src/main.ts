import { Deferred } from '@scrypted/common/src/deferred';
import { listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, {
    AdoptDevice, Device, DeviceCreator, DeviceCreatorSettings, DeviceDiscovery, DeviceProvider,
    DiscoveredDevice, FFmpegInput, MediaObject, RequestMediaStreamOptions, ResponseMediaStreamOptions,
    ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings,
    SettingValue, VideoCamera,
} from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { randomBytes } from 'crypto';
import { Writable } from 'stream';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { findSpsPps, H264SpsPps, KASA_DEFAULT_PORT, KasaClient, KasaMimeG711U, KasaMimeVideo, KasaPart } from './kasa-api';
import { discoverKasa, KasaDiscoveredDevice, tcpProbeKasaCameras } from './kasa-discovery';

// Models in this set are TP-Link Kasa cameras (sysinfo.type === 'IOT.IPCAMERA' is the primary
// filter; this is a defense-in-depth allowlist for ambiguous replies).
const KASA_CAMERA_TYPES = new Set(['IOT.IPCAMERA']);

// Hard ceiling on the upfront SPS/PPS scan. Real cameras emit them well under a second; if we
// don't see them in this window the camera is misbehaving and there's no point holding the call.
const SPS_PPS_TIMEOUT_MS = 10000;

const { deviceManager, mediaManager, systemManager } = sdk;

// Walk every known device's state to collect existing room names. Used to populate the room
// dropdown so the user picks an existing room instead of typing a new one.
function getKnownRooms(): string[] {
    const rooms = new Set<string>();
    const states = systemManager.getSystemState();
    for (const id of Object.keys(states)) {
        const room = states[id]?.room?.value;
        if (typeof room === 'string' && room.trim())
            rooms.add(room.trim());
    }
    return [...rooms].sort((a, b) => a.localeCompare(b));
}

class KasaCamera extends ScryptedDeviceBase implements VideoCamera, Settings {
    storageSettings = new StorageSettings(this, {
        ip: {
            title: 'IP Address',
            placeholder: '192.168.1.100',
        },
        port: {
            title: 'Port',
            type: 'number',
            defaultValue: KASA_DEFAULT_PORT,
        },
        username: {
            title: 'Username (Kasa Email)',
            placeholder: 'user@example.com',
            description: 'The TP-Link/Kasa account email associated with the camera.',
        },
        password: {
            title: 'Password (Kasa Account)',
            type: 'password',
            description: 'The TP-Link/Kasa account password.',
        },
    });

    constructor(nativeId: string) {
        super(nativeId);
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            {
                container: 'rtsp',
                id: 'mixed',
                name: 'Mixed',
                video: {
                    codec: 'h264',
                },
                audio: {
                    codec: 'pcm_mulaw',
                },
                tool: 'scrypted',
                userConfigurable: false,
            },
        ];
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        const { ip, port, username, password } = this.storageSettings.values;

        if (!ip || !username || !password)
            throw new Error('Kasa camera is not configured. Set IP, username, and password.');

        const kasa = await KasaClient.connect({
            ip,
            port,
            username,
            password,
        });

        // Single shared kill switch: any teardown source (kasa close, ffmpeg exit, RTSP client
        // disconnect, pump error) resolves it, and every owned resource registers a cleanup.
        const kill = new Deferred<void>();
        kill.promise.finally(() => kasa.destroy());
        kasa.body.on('close', () => kill.resolve());
        kasa.body.on('error', () => kill.resolve());

        // Read upfront until we have SPS+PPS so they can be inlined into the SDP. Without this,
        // clients (especially short-timeout ones like HomeKit) may give up before the first
        // in-band SPS/PPS arrives. Buffer everything so we can replay to ffmpeg with no frame loss.
        const buffered: KasaPart[] = [];
        const spsPps: H264SpsPps = {};
        try {
            const deadline = Date.now() + SPS_PPS_TIMEOUT_MS;
            while (!spsPps.sps || !spsPps.pps) {
                if (Date.now() > deadline)
                    throw new Error('timed out waiting for H.264 SPS/PPS');
                const part = await kasa.readPart();
                buffered.push(part);
                if (part.contentType === KasaMimeVideo)
                    findSpsPps(part.body, spsPps);
            }
        }
        catch (e) {
            kasa.destroy();
            throw e;
        }
        const sps = spsPps.sps!;
        const pps = spsPps.pps!;
        // RFC 6184: profile-level-id is the 3 SPS bytes (profile_idc, profile-iop, level_idc)
        // immediately following the NAL header byte, encoded as 6 hex chars.
        const profileLevelId = sps.subarray(1, 4).toString('hex').toUpperCase();
        const spropParameterSets = sps.toString('base64') + ',' + pps.toString('base64');

        const rtspServer = await listenSingleRtspClient();
        kill.promise.finally(() => rtspServer.server.close());

        rtspServer.rtspServerPromise.then(async rtsp => {
            kill.promise.finally(() => rtsp.client.destroy());
            rtsp.client.on('close', () => kill.resolve());

            try {
                // We build the SDP ourselves rather than using forwarder.sdpContents because the
                // helper parses ffmpeg's -sdp_file output as it streams in: the audio m-section
                // can arrive in a later chunk, but audioSectionDeferred has already been resolved
                // with `undefined` by then, so the audio track silently gets dropped. Codecs are
                // fixed for kasa (H.264 PT=96, PCMU PT=0), so a static SDP is safe and complete.
                // The ports are 0 because clients reach us via the local RTSP server, not ffmpeg.
                const staticSdp = [
                    'v=0',
                    'o=- 0 0 IN IP4 127.0.0.1',
                    's=Kasa',
                    'c=IN IP4 127.0.0.1',
                    't=0 0',
                    'm=video 0 RTP/AVP 96',
                    'a=rtpmap:96 H264/90000',
                    `a=fmtp:96 packetization-mode=1; profile-level-id=${profileLevelId}; sprop-parameter-sets=${spropParameterSets}`,
                    'm=audio 0 RTP/AVP 0',
                    'a=rtpmap:0 PCMU/8000',
                ].join('\r\n');
                const sdp = addTrackControls(staticSdp);
                rtsp.sdp = sdp;
                const parsedSdp = parseSdp(sdp);
                // Both must exist by construction; the .control values feed into onRtp callbacks
                // below before any RTP can fire, so no TDZ hazard.
                const videoTrack = parsedSdp.msections.find(s => s.type === 'video')!;
                const audioTrack = parsedSdp.msections.find(s => s.type === 'audio')!;

                // pipe:3 + pipe:5: startRtpForwarderProcess reserves pipe:4 for its own
                // -sdp_file output, so we steer our two raw inputs around it.
                // Both codecs are passed through (`-vcodec copy`, `-acodec copy`); ffmpeg does
                // RTP framing only and never touches the bitstream.
                const forwarder = await startRtpForwarderProcess(this.console, {
                    inputArguments: [
                        '-f', 'h264',
                        '-i', 'pipe:3',
                        '-f', 'mulaw',
                        '-ar', '8000',
                        '-ac', '1',
                        '-i', 'pipe:5',
                    ],
                }, {
                    video: {
                        onRtp: rtp => rtsp.sendTrack(videoTrack.control, rtp, false),
                        encoderArguments: [
                            '-vcodec', 'copy',
                        ],
                    },
                    audio: {
                        onRtp: rtp => rtsp.sendTrack(audioTrack.control, rtp, false),
                        encoderArguments: [
                            '-acodec', 'copy',
                        ],
                    },
                });

                forwarder.killPromise.finally(() => kill.resolve());
                kill.promise.finally(() => forwarder.kill());

                rtsp.handlePlayback().catch(() => kill.resolve());

                const videoPipe = forwarder.cp.stdio[3] as Writable;
                const audioPipe = (forwarder.cp.stdio as any)[5] as Writable;
                videoPipe.on('error', () => kill.resolve());
                audioPipe.on('error', () => kill.resolve());

                this.pump(kasa, videoPipe, audioPipe, buffered).catch(e => {
                    this.console.error('kasa stream pump error', e);
                    kill.resolve();
                });
            }
            catch (e) {
                this.console.error('kasa rtsp/ffmpeg setup failed', e);
                rtsp.client.destroy();
                kill.resolve();
            }
        });

        const ffmpegInput: FFmpegInput = {
            url: rtspServer.url,
            mediaStreamOptions: (await this.getVideoStreamOptions())[0],
            inputArguments: [
                '-i', rtspServer.url,
            ],
        };

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    // Replays the parts captured during the SPS/PPS scan (so ffmpeg sees the SPS+PPS+IDR
    // sequence required to start decoding) and then continues pumping live parts. We don't
    // honor backpressure: kasa cameras emit a steady ~modest bitrate and ffmpeg keeps up in
    // codec-copy mode, so accumulating drain promises would just add latency.
    private async pump(kasa: KasaClient, videoPipe: Writable, audioPipe: Writable, buffered: KasaPart[]): Promise<void> {
        const writePart = (part: KasaPart) => {
            switch (part.contentType) {
                case KasaMimeVideo:
                    if (!videoPipe.writableEnded)
                        videoPipe.write(part.body);
                    break;
                case KasaMimeG711U:
                    if (!audioPipe.writableEnded)
                        audioPipe.write(part.body);
                    break;
            }
        };

        try {
            for (const part of buffered)
                writePart(part);
            while (true) {
                const part = await kasa.readPart();
                writePart(part);
            }
        }
        finally {
            try { videoPipe.end(); } catch { }
            try { audioPipe.end(); } catch { }
        }
    }
}

interface KasaDiscoveryEntry {
    device: KasaDiscoveredDevice;
    // The cached entry expires so a stale IP/MAC mapping doesn't linger across DHCP changes.
    timeout: NodeJS.Timeout;
}

class KasaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, DeviceDiscovery {
    devices = new Map<string, KasaCamera>();
    discoveredDevices = new Map<string, KasaDiscoveryEntry>();
    // In-flight scan so concurrent scan=true calls share one network round-trip instead of
    // each kicking off its own broadcast + TCP sweep.
    private scanInFlight?: Promise<void>;

    constructor(nativeId?: string) {
        super(nativeId);
        this.systemDevice = {
            deviceCreator: 'Kasa Camera',
            deviceDiscovery: 'Kasa Cameras',
        };
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                placeholder: 'Front Door, Living Room, etc.',
            },
            {
                key: 'room',
                title: 'Room',
                placeholder: 'Optional, e.g. Living Room',
                choices: getKnownRooms(),
                combobox: true,
            },
        ];
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: ScryptedNativeId): Promise<string> {
        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.name?.toString() || 'Kasa Camera';
        const room = settings.room?.toString() || undefined;
        await this.registerCamera(nativeId, name, room);
        return nativeId;
    }

    private async registerCamera(nativeId: string, name: string, room?: string): Promise<void> {
        const device: Device = {
            nativeId,
            name,
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
            ],
            info: {
                manufacturer: 'TP-Link',
            },
            // Empty string would clear the room on re-discovery; pass undefined to leave alone.
            room: room || undefined,
        };
        await deviceManager.onDeviceDiscovered(device);
    }

    async discoverDevices(scan?: boolean): Promise<DiscoveredDevice[]> {
        // Discovery never runs unless explicitly requested (scan === true). When it does, an
        // in-flight scan is shared across overlapping callers so a single click never produces
        // more than one network round-trip; calls without scan=true just return the cache.
        if (scan) {
            if (!this.scanInFlight) {
                this.scanInFlight = this.runScan().finally(() => {
                    this.scanInFlight = undefined;
                });
            }
            await this.scanInFlight;
        }

        const defaults = this.getDefaultCredentials();
        const rooms = getKnownRooms();
        return [...this.discoveredDevices.values()].map(({ device }) => ({
            nativeId: device.deviceId,
            name: device.alias || device.model || 'Kasa Camera',
            description: `${device.model || 'Kasa Camera'} @ ${device.address}`,
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
            ],
            info: {
                manufacturer: 'TP-Link',
                model: device.model,
                mac: device.mac,
                ip: device.address,
            },
            // Discovery only finds the camera on the LAN; the cloud account credentials are
            // still required to authenticate the stream, so collect them at adoption time.
            // Name is pre-filled from the camera's alias/model but can be overridden — alias
            // is empty for TCP-only candidates, so the field is also a chance to set one then.
            settings: [
                {
                    key: 'name',
                    title: 'Name',
                    value: device.alias || device.model || 'Kasa Camera',
                },
                {
                    key: 'room',
                    title: 'Room',
                    placeholder: 'Optional, e.g. Living Room',
                    choices: rooms,
                    combobox: true,
                },
                {
                    key: 'username',
                    title: 'Username (Kasa Email)',
                    placeholder: 'user@example.com',
                    value: defaults.username,
                },
                {
                    key: 'password',
                    title: 'Password (Kasa Account)',
                    type: 'password',
                    value: defaults.password,
                },
            ],
        }));
    }

    // Run UDP/9999 broadcast discovery and TCP/19443 sweep in parallel. UDP gives us rich
    // metadata (alias, model, MAC, deviceId) for cameras that speak the IOT protocol; TCP
    // catches cameras whose firmware doesn't answer LAN discovery.
    private async runScan(): Promise<void> {
        try {
            const [udpResults, tcpResults] = await Promise.all([
                discoverKasa(3000, this.console).catch(e => {
                    this.console.error('kasa udp discovery failed', e);
                    return [] as KasaDiscoveredDevice[];
                }),
                tcpProbeKasaCameras(2000, this.console).catch(e => {
                    this.console.error('kasa tcp probe failed', e);
                    return [];
                }),
            ]);

            const skipped: string[] = [];
            let cameras = 0;
            const udpAddresses = new Set<string>();
            for (const d of udpResults) {
                udpAddresses.add(d.address);
                if (deviceManager.getNativeIds().includes(d.deviceId))
                    continue;
                if (d.type && !KASA_CAMERA_TYPES.has(d.type)) {
                    skipped.push(`${d.alias || d.model || d.deviceId} (${d.type})`);
                    continue;
                }
                cameras++;
                this.upsertDiscovered(d.deviceId, d);
            }

            // Promote any TCP-only candidate (no UDP metadata) to a synthetic discovered
            // device. Without metadata we synthesize a deviceId from the IP; the user can
            // rename on adoption.
            for (const c of tcpResults) {
                if (udpAddresses.has(c.address))
                    continue;
                const deviceId = `kasa-tcp-${c.address}`;
                if (deviceManager.getNativeIds().includes(deviceId))
                    continue;
                cameras++;
                this.upsertDiscovered(deviceId, {
                    address: c.address,
                    deviceId,
                    alias: '',
                    model: 'Kasa Camera',
                    mac: '',
                    type: 'IOT.IPCAMERA',
                    sysinfo: {},
                });
            }

            this.console.log(`kasa discovery: ${udpResults.length} udp responder(s), `
                + `${tcpResults.length} tcp candidate(s), ${cameras} camera(s)`
                + (skipped.length ? `, skipped non-cameras: ${skipped.join(', ')}` : ''));
            this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, undefined);
        }
        catch (e) {
            this.console.error('kasa discovery failed', e);
        }
    }

    // In typical home setups, every Kasa camera shares the same TP-Link account, so reuse
    // the credentials from any already-configured camera as defaults for newly discovered
    // ones. The user can still override per-camera in the adoption form.
    private getDefaultCredentials(): { username: string; password: string } {
        for (const nativeId of deviceManager.getNativeIds()) {
            if (!nativeId)
                continue;
            const storage = deviceManager.getDeviceStorage(nativeId);
            const username = storage?.getItem('username');
            const password = storage?.getItem('password');
            if (username && password)
                return { username, password };
        }
        return { username: '', password: '' };
    }

    private upsertDiscovered(deviceId: string, device: KasaDiscoveredDevice) {
        const existing = this.discoveredDevices.get(deviceId);
        if (existing)
            clearTimeout(existing.timeout);
        this.discoveredDevices.set(deviceId, {
            device,
            timeout: setTimeout(() => this.discoveredDevices.delete(deviceId), 5 * 60 * 1000),
        });
    }

    async adoptDevice(adopt: AdoptDevice): Promise<string> {
        const entry = this.discoveredDevices.get(adopt.nativeId);
        if (!entry)
            throw new Error('kasa device not found in discovered set; rescan and try again');

        const { device } = entry;
        const name = (adopt.settings.name?.toString() || device.alias || device.model || 'Kasa Camera');
        const room = adopt.settings.room?.toString() || undefined;

        await this.registerCamera(adopt.nativeId, name, room);
        const camera = await this.getDevice(adopt.nativeId);

        // Pre-populate the per-camera settings discovered on the LAN plus the credentials the
        // user supplied during adoption. The stream open happens later, on first getVideoStream.
        camera.storageSettings.values.ip = device.address;
        camera.storageSettings.values.port = KASA_DEFAULT_PORT;
        if (adopt.settings.username)
            camera.storageSettings.values.username = adopt.settings.username.toString();
        if (adopt.settings.password)
            camera.storageSettings.values.password = adopt.settings.password.toString();

        clearTimeout(entry.timeout);
        this.discoveredDevices.delete(adopt.nativeId);
        this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, undefined);
        return camera.id;
    }

    async getDevice(nativeId: string): Promise<KasaCamera> {
        let camera = this.devices.get(nativeId);
        if (!camera) {
            camera = new KasaCamera(nativeId);
            this.devices.set(nativeId, camera);
        }
        return camera;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId);
    }
}

export default KasaPlugin;
