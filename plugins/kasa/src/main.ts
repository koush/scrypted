import { Deferred } from '@scrypted/common/src/deferred';
import { listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, {
    AdoptDevice, Device, DeviceCreator, DeviceCreatorSettings, DeviceDiscovery, DeviceProvider,
    DiscoveredDevice, FFmpegInput, Intercom, MediaObject, OnOff, RequestMediaStreamOptions, ResponseMediaStreamOptions,
    ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, Settings,
    SettingValue, VideoCamera,
} from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { randomBytes } from 'crypto';
import { Writable } from 'stream';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import child_process, { ChildProcess } from 'child_process';
import { findSpsPps, H264SpsPps, KASA_DEFAULT_PORT, KasaClient, KasaMimeG711U, KasaMimeVideo, KasaPart } from './kasa-api';
import { KasaBulb } from './kasa-bulb';
import { discoverKasa, KasaDiscoveredDevice } from './kasa-discovery';
import { KASA_TALK_PORT, KasaTalkSession } from './kasa-intercom';
import { KASA_IOT_PORT } from './kasa-iot';
import { KasaLinkieClient } from './kasa-linkie';
import { KasaDimmer } from './kasa-dimmer';
import { KasaPlug } from './kasa-plug';
import { KasaSwitch } from './kasa-switch';

// G.711 µ-law packetization: 8000 samples/sec * 1 byte/sample = 160 bytes/20ms.
// 20 ms is the standard RTP packetization for PCMU and matches what the Kasa app appears
// to use for its uplink chunks during active talk.
const TALK_CHUNK_BYTES = 160;

// Models in this set are TP-Link Kasa cameras (sysinfo.type === 'IOT.IPCAMERA' is the primary
// filter; this is a defense-in-depth allowlist for ambiguous replies).
const KASA_CAMERA_TYPES = new Set(['IOT.IPCAMERA']);

type KasaDeviceClass = 'camera' | 'plug' | 'switch' | 'bulb';

// Classify a discovered device by its sysinfo. Returns undefined for device families we
// don't model (e.g. multi-outlet plug strips, hubs).
function classifyKasa(d: KasaDiscoveredDevice): KasaDeviceClass | undefined {
    if (KASA_CAMERA_TYPES.has(d.type))
        return 'camera';
    if (d.type === 'IOT.SMARTBULB')
        return 'bulb';
    if (d.type === 'IOT.SMARTPLUGSWITCH') {
        // The Kasa app distinguishes outlets from light switches by `dev_name` /
        // `description`. HS200/210/220 are wall-mounted switches; everything else is an
        // outlet. Multi-outlet strips have a `children` array and are skipped — they need
        // per-outlet handling we don't do yet.
        if (Array.isArray((d.sysinfo as any)?.children) && (d.sysinfo as any).children.length)
            return undefined;
        const devName: string = (d.sysinfo as any)?.dev_name || '';
        if (/switch|dimmer/i.test(devName))
            return 'switch';
        return 'plug';
    }
    return undefined;
}

function isDimmer(d: KasaDiscoveredDevice): boolean {
    const sys = d.sysinfo as any;
    if (typeof sys?.brightness === 'number')
        return true;
    const feature: string = sys?.feature || '';
    if (/DIM/.test(feature))
        return true;
    // KS230 (3-way dimmer) doesn't report `brightness` in sysinfo at idle, and its
    // `feature` string doesn't include DIM either — but `dev_name` always says "Dimmer".
    const devName: string = sys?.dev_name || '';
    return /dimmer/i.test(devName);
}

interface BulbCapabilities {
    isColor: boolean;
    isVariableColorTemp: boolean;
}

function bulbCapabilities(d: KasaDiscoveredDevice): BulbCapabilities {
    const sys = d.sysinfo as any;
    return {
        isColor: sys?.is_color === 1,
        isVariableColorTemp: sys?.is_variable_color_temp === 1,
    };
}

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

// Child device for cameras with a spotlight (e.g. KC420WS — the Kasa app calls this
// the "spotlight"). Backed by the LINKIE2 `smartlife.cam.ipcamera.dayNight.set_force_lamp_state`
// command. (The protocol-level name is "force_lamp" — internally the camera firmware
// treats this as a generic forced-lamp state, but in the user-facing UI it's a spotlight.)
class KasaCameraSpotlight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: KasaCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOn(): Promise<void> {
        await this.camera.linkie().setForceLampState(true);
        this.on = true;
    }

    async turnOff(): Promise<void> {
        await this.camera.linkie().setForceLampState(false);
        this.on = false;
    }
}

// Child device for the siren. Backed by smartlife.cam.ipcamera.siren.set_state. The
// camera auto-stops after the duration set in the Kasa app (default 30 s), so the `on`
// state shown in Scrypted may not reflect that auto-off until something polls again.
class KasaCameraSiren extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: KasaCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOn(): Promise<void> {
        await this.camera.linkie().setSirenState(true);
        this.on = true;
    }

    async turnOff(): Promise<void> {
        await this.camera.linkie().setSirenState(false);
        this.on = false;
    }
}

class KasaCamera extends ScryptedDeviceBase implements VideoCamera, Settings, Intercom, DeviceProvider, OnOff {
    private intercomSession?: KasaTalkSession;
    private intercomFfmpeg?: ChildProcess;
    private spotlight?: KasaCameraSpotlight;
    private siren?: KasaCameraSiren;

    constructor(nativeId: string) {
        super(nativeId);
        // Probe-and-register child devices once settings are available. process.nextTick
        // defers past constructor so storageSettings is fully wired.
        process.nextTick(() => this.refreshChildDevices().catch(e =>
            this.console.warn('refreshChildDevices failed', e)));
    }

    linkie(): KasaLinkieClient {
        const { ip, username, password } = this.storageSettings.values;
        // Don't pass storageSettings.port — that's the stream port (19443). LINKIE2 lives
        // on its own fixed port (10443) which the client supplies as a default.
        return new KasaLinkieClient({ ip, username, password }, this.console);
    }

    private get spotlightNativeId(): string {
        return `${this.nativeId}-spotlight`;
    }

    private get sirenNativeId(): string {
        return `${this.nativeId}-siren`;
    }

    async refreshChildDevices(): Promise<void> {
        const { ip, username, password } = this.storageSettings.values;
        if (!ip || !username || !password)
            return;

        const linkie = this.linkie();
        // Probe each capability sequentially. The Kasa iOS app issues LINKIE2 calls
        // serially; firing them in parallel against the same camera occasionally drops
        // responses (likely camera-side request serialization).
        const ledState = await linkie.getLedStatus();
        const lampState = await linkie.getForceLampState();
        const sirenState = await linkie.getSirenState();

        if (ledState !== undefined)
            this.on = ledState === 'on';

        if (lampState !== undefined) {
            await deviceManager.onDeviceDiscovered({
                nativeId: this.spotlightNativeId,
                name: `${this.name || 'Kasa Camera'} Spotlight`,
                type: ScryptedDeviceType.Light,
                interfaces: [ScryptedInterface.OnOff],
                providerNativeId: this.nativeId,
                // Inherit the camera's room so children show up next to it in the UI.
                // Empty string would clear an existing room assignment, so pass undefined.
                room: this.room || undefined,
            });
            if (!this.spotlight)
                this.spotlight = new KasaCameraSpotlight(this, this.spotlightNativeId);
            this.spotlight.on = lampState === 'on';
        }

        if (sirenState !== undefined) {
            await deviceManager.onDeviceDiscovered({
                nativeId: this.sirenNativeId,
                name: `${this.name || 'Kasa Camera'} Siren`,
                type: ScryptedDeviceType.Switch,
                interfaces: [ScryptedInterface.OnOff],
                providerNativeId: this.nativeId,
                room: this.room || undefined,
            });
            if (!this.siren)
                this.siren = new KasaCameraSiren(this, this.sirenNativeId);
            this.siren.on = sirenState === 'on';
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId === this.spotlightNativeId) {
            if (!this.spotlight)
                this.spotlight = new KasaCameraSpotlight(this, this.spotlightNativeId);
            return this.spotlight;
        }
        if (nativeId === this.sirenNativeId) {
            if (!this.siren)
                this.siren = new KasaCameraSiren(this, this.sirenNativeId);
            return this.siren;
        }
    }

    async releaseDevice(_id: string, _nativeId: string): Promise<void> {
        // No persistent resources per child to release.
    }

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

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
        // Re-probe child devices when network or auth settings change. Manually-added
        // cameras get their credentials filled in here (rather than at adoption), so this
        // is the moment the spotlight first becomes detectable.
        if (key === 'ip' || key === 'port' || key === 'username' || key === 'password')
            this.refreshChildDevices().catch(e => this.console.warn('refreshChildDevices failed', e));
    }

    // OnOff drives the camera's status LED. HomeKit binds its CameraOperatingModeIndicator
    // characteristic to this when "Link Status Indicator" is enabled in the HomeKit per-camera
    // settings, so the user can toggle the LED from HomeKit. In Scrypted's UI this surfaces
    // as a plain on/off control on the camera page.
    async turnOn(): Promise<void> {
        await this.linkie().setLedStatus(true);
        this.on = true;
    }

    async turnOff(): Promise<void> {
        await this.linkie().setLedStatus(false);
        this.on = false;
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

                // ffmpeg keeps emitting RTP for a few packets after the consumer disconnects;
                // a write to a half-closed socket throws EPIPE. Drop packets after teardown
                // and catch any in-flight write race so we don't crash the plugin.
                const safeSendTrack = (control: string, rtp: Buffer) => {
                    if (kill.finished || rtsp.client.destroyed)
                        return;
                    try {
                        rtsp.sendTrack(control, rtp, false);
                    }
                    catch { }
                };

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
                        onRtp: rtp => safeSendTrack(videoTrack.control, rtp),
                        encoderArguments: [
                            '-vcodec', 'copy',
                        ],
                    },
                    audio: {
                        onRtp: rtp => safeSendTrack(audioTrack.control, rtp),
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

    async startIntercom(media: MediaObject): Promise<void> {
        // Some Scrypted clients call startIntercom again without an intervening stopIntercom
        // (e.g. switching audio sources). Tear down any prior session first so we don't leak
        // an in-flight ffmpeg process or a half-open POST to the camera.
        await this.stopIntercom();

        const { ip, port, username, password } = this.storageSettings.values;
        if (!ip || !username || !password)
            throw new Error('Kasa camera is not configured.');

        const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

        const session = new KasaTalkSession({
            ip,
            port: KASA_TALK_PORT,
            username,
            password,
            console: this.console,
        });
        this.intercomSession = session;
        await session.start();

        // ffmpeg transcodes whatever audio Scrypted hands us (Opus/AAC/PCM/...) into raw
        // 8 kHz mono G.711 µ-law on stdout, which we chunk into 20 ms blocks and write
        // into the talk session as multipart parts.
        const ffmpegPath = await mediaManager.getFFmpegPath();
        const args = [
            '-hide_banner',
            ...(ffmpegInput.inputArguments || []),
            '-vn', '-sn', '-dn',
            '-f', 'mulaw',
            '-ar', '8000',
            '-ac', '1',
            'pipe:1',
        ];
        const cp = child_process.spawn(ffmpegPath, args);
        this.intercomFfmpeg = cp;

        let buf: Buffer = Buffer.alloc(0);
        cp.stdout!.on('data', (chunk: Buffer) => {
            buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
            while (buf.length >= TALK_CHUNK_BYTES) {
                session.writeAudio(buf.subarray(0, TALK_CHUNK_BYTES));
                buf = buf.subarray(TALK_CHUNK_BYTES);
            }
        });
        cp.stderr!.on('data', d => this.console.log('intercom ffmpeg:', d.toString().trim()));
        cp.on('exit', () => {
            this.console.log('intercom ffmpeg exited');
            session.close();
        });
    }

    async stopIntercom(): Promise<void> {
        const session = this.intercomSession;
        const cp = this.intercomFfmpeg;
        this.intercomSession = undefined;
        this.intercomFfmpeg = undefined;
        session?.close();
        try { cp?.kill(); } catch { }
    }
}

interface KasaDiscoveryEntry {
    device: KasaDiscoveredDevice;
    // The cached entry expires so a stale IP/MAC mapping doesn't linger across DHCP changes.
    timeout: NodeJS.Timeout;
}

class KasaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, DeviceDiscovery {
    devices = new Map<string, KasaCamera | KasaPlug | KasaSwitch | KasaDimmer | KasaBulb>();
    discoveredDevices = new Map<string, KasaDiscoveryEntry>();
    // In-flight scan so concurrent scan=true calls share one network round-trip instead of
    // each kicking off its own broadcast + TCP sweep.
    private scanInFlight?: Promise<void>;
    // Suppress redundant re-scans for this long after one completes. Scrypted's discovery
    // UI fires scan=true on every type-filter click; a fresh scan + onDeviceEvent on every
    // click resets the user-applied filter. Returning cached results skips both.
    private static SCAN_COOLDOWN_MS = 5000;
    private lastScanAt = 0;

    constructor(nativeId?: string) {
        super(nativeId);
        this.systemDevice = {
            deviceCreator: 'Device',
            deviceDiscovery: 'Kasa Devices',
        };
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'kasaClass',
                title: 'Type',
                choices: ['Camera', 'Plug', 'Switch', 'Dimmer', 'Bulb'],
                value: 'Camera',
            },
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
        const room = settings.room?.toString() || undefined;
        const choice = settings.kasaClass?.toString() || 'Camera';
        // Map the user-friendly choice → internal kasaClass marker. Defaults to camera.
        const kasaClass = ({
            Camera: 'camera',
            Plug: 'plug',
            Switch: 'switch',
            Dimmer: 'dimmer',
            Bulb: 'bulb',
        } as Record<string, string>)[choice] || 'camera';
        const name = settings.name?.toString() || (choice === 'Camera' ? 'Kasa Camera' : `Kasa ${choice}`);

        if (kasaClass === 'camera') {
            await this.registerCamera(nativeId, name, room);
            deviceManager.getDeviceStorage(nativeId).setItem('kasaClass', 'camera');
            return nativeId;
        }
        await this.registerIotDevice(nativeId, name, room, kasaClass);
        return nativeId;
    }

    // Register a non-camera Kasa device (plug, switch, dimmer, bulb) with the appropriate
    // Scrypted device type + interfaces. IP/port are left empty; the user fills them in
    // through the per-device settings after creation.
    private async registerIotDevice(nativeId: string, name: string, room: string | undefined, kasaClass: string): Promise<void> {
        const interfaces = [ScryptedInterface.OnOff, ScryptedInterface.Settings];
        let type: ScryptedDeviceType;
        switch (kasaClass) {
            case 'plug':
                type = ScryptedDeviceType.Outlet;
                break;
            case 'switch':
                type = ScryptedDeviceType.Switch;
                break;
            case 'dimmer':
                type = ScryptedDeviceType.Light;
                interfaces.push(ScryptedInterface.Brightness);
                break;
            case 'bulb':
                type = ScryptedDeviceType.Light;
                interfaces.push(ScryptedInterface.Brightness);
                // Color/color-temp interfaces are probed from sysinfo on adoption; manual-
                // create bulbs default to brightness only. The user can re-discover if they
                // need full color support detected automatically.
                break;
            default:
                throw new Error(`unknown kasaClass: ${kasaClass}`);
        }
        await deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            type,
            interfaces,
            info: { manufacturer: 'TP-Link Kasa' },
            room: room || undefined,
        });
        deviceManager.getDeviceStorage(nativeId).setItem('kasaClass', kasaClass);
    }

    private async registerCamera(nativeId: string, name: string, room?: string, info?: { model?: string; mac?: string; ip?: string; serialNumber?: string; firmware?: string }): Promise<void> {
        const device: Device = {
            nativeId,
            name,
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                // Required so Scrypted routes child-device lookups (e.g. the spotlight)
                // through KasaCamera.getDevice rather than treating the camera as a leaf.
                ScryptedInterface.DeviceProvider,
                // OnOff drives the camera's status LED — HomeKit binds its
                // CameraOperatingModeIndicator characteristic to this.
                ScryptedInterface.OnOff,
            ],
            info: {
                manufacturer: 'TP-Link Kasa',
                model: info?.model || undefined,
                mac: info?.mac || undefined,
                ip: info?.ip || undefined,
                serialNumber: info?.serialNumber || undefined,
                firmware: info?.firmware || undefined,
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
            if (this.scanInFlight) {
                await this.scanInFlight;
            }
            else if (Date.now() - this.lastScanAt < KasaPlugin.SCAN_COOLDOWN_MS) {
                // Recent scan already completed — return cached list without re-scanning
                // or re-firing onDeviceEvent (which would reset UI filters).
            }
            else {
                this.scanInFlight = this.runScan().finally(() => {
                    this.scanInFlight = undefined;
                    this.lastScanAt = Date.now();
                });
                await this.scanInFlight;
            }
        }

        const defaults = this.getDefaultCredentials();
        const rooms = getKnownRooms();
        const out: DiscoveredDevice[] = [];
        for (const { device } of this.discoveredDevices.values()) {
            const cls = classifyKasa(device);
            if (!cls)
                continue;
            out.push(this.buildDiscoveredDevice(device, cls, rooms, defaults));
        }
        return out;
    }

    private buildDiscoveredDevice(
        device: KasaDiscoveredDevice,
        cls: KasaDeviceClass,
        rooms: string[],
        defaults: { username: string; password: string },
    ): DiscoveredDevice {
        const info = {
            manufacturer: 'TP-Link Kasa',
            model: device.model,
            mac: device.mac,
            ip: device.address,
        };
        const fallbackName = device.alias || device.model || 'Kasa Device';

        // Common settings on every adoption form. Cameras add username/password below.
        const baseSettings: Setting[] = [
            { key: 'name', title: 'Name', value: fallbackName },
            { key: 'room', title: 'Room', placeholder: 'Optional, e.g. Living Room', choices: rooms, combobox: true },
        ];

        if (cls === 'camera') {
            return {
                nativeId: device.deviceId,
                name: fallbackName,
                description: `${device.model || 'Kasa Camera'} @ ${device.address}`,
                type: ScryptedDeviceType.Camera,
                interfaces: [
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.Settings,
                    ScryptedInterface.Intercom,
                    ScryptedInterface.DeviceProvider,
                    ScryptedInterface.OnOff,
                ],
                info,
                // Cameras need the cloud account credentials too — auth on the stream/talk
                // endpoints. Plugs/bulbs are local-only with no auth.
                settings: [
                    ...baseSettings,
                    { key: 'username', title: 'Username (Kasa Email)', placeholder: 'user@example.com', value: defaults.username },
                    { key: 'password', title: 'Password (Kasa Account)', type: 'password', value: defaults.password },
                ],
            };
        }

        // Plug, Switch, Bulb — all share the same simpler adoption form.
        const interfaces = [ScryptedInterface.OnOff, ScryptedInterface.Settings];
        let type: ScryptedDeviceType;
        if (cls === 'bulb') {
            type = ScryptedDeviceType.Light;
            interfaces.push(ScryptedInterface.Brightness);
            const caps = bulbCapabilities(device);
            if (caps.isColor)
                interfaces.push(ScryptedInterface.ColorSettingHsv);
            if (caps.isVariableColorTemp)
                interfaces.push(ScryptedInterface.ColorSettingTemperature);
        }
        else {
            // Dimmer plug/switch (HS220, KS230, ...) is almost always wired to a light, so
            // expose as Light. Plain plugs → Outlet; plain switches → Switch.
            const dimmer = isDimmer(device);
            if (dimmer) {
                type = ScryptedDeviceType.Light;
                interfaces.push(ScryptedInterface.Brightness);
            }
            else {
                type = cls === 'switch' ? ScryptedDeviceType.Switch : ScryptedDeviceType.Outlet;
            }
        }

        return {
            nativeId: device.deviceId,
            name: fallbackName,
            description: `${device.model || 'Kasa Device'} @ ${device.address}`,
            type,
            interfaces,
            info,
            settings: baseSettings,
        };
    }

    // Single-pass UDP discovery: broadcast + paced unicast sweep on the local /24, all on
    // one socket. Fast (~2.5 s) because there's no TCP handshake step and no second pass.
    private async runScan(): Promise<void> {
        try {
            const udpResults = await discoverKasa(2500, this.console).catch(e => {
                this.console.error('kasa udp discovery failed', e);
                return [] as KasaDiscoveredDevice[];
            });

            const skipped: string[] = [];
            const classCounts: Record<string, number> = {};
            for (const d of udpResults) {
                if (deviceManager.getNativeIds().includes(d.deviceId))
                    continue;
                const cls = classifyKasa(d);
                if (!cls) {
                    skipped.push(`${d.alias || d.model || d.deviceId} (${d.type})`);
                    continue;
                }
                classCounts[cls] = (classCounts[cls] || 0) + 1;
                this.upsertDiscovered(d.deviceId, d);
            }

            const summary = Object.entries(classCounts).map(([k, v]) => `${v} ${k}(s)`).join(', ') || '0 supported devices';
            this.console.log(`kasa discovery: ${udpResults.length} responder(s), ${summary}`
                + (skipped.length ? `, skipped: ${skipped.join(', ')}` : ''));
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
        const cls = classifyKasa(device);
        if (!cls)
            throw new Error(`kasa device type ${device.type} is not supported for adoption`);

        const name = (adopt.settings.name?.toString() || device.alias || device.model || 'Kasa Device');
        const room = adopt.settings.room?.toString() || undefined;

        let id: string;
        if (cls === 'camera')
            id = await this.adoptCamera(adopt, device, name, room);
        else
            id = await this.adoptIotDevice(adopt, device, cls, name, room);

        clearTimeout(entry.timeout);
        this.discoveredDevices.delete(adopt.nativeId);
        this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, undefined);
        return id;
    }

    private async adoptCamera(adopt: AdoptDevice, device: KasaDiscoveredDevice, name: string, room?: string): Promise<string> {
        // deviceId is the Kasa-issued 40-char hex per-unit identifier — treat it as the
        // serial number, which is what HomeKit and the UI expect under that label.
        await this.registerCamera(adopt.nativeId, name, room, {
            model: device.model,
            mac: device.mac,
            ip: device.address,
            serialNumber: device.deviceId,
            firmware: typeof device.sysinfo?.sw_ver === 'string' ? device.sysinfo.sw_ver : undefined,
        });
        deviceManager.getDeviceStorage(adopt.nativeId).setItem('kasaClass', 'camera');
        const camera = (await this.getDevice(adopt.nativeId)) as KasaCamera;

        camera.storageSettings.values.ip = device.address;
        camera.storageSettings.values.port = KASA_DEFAULT_PORT;
        if (adopt.settings.username)
            camera.storageSettings.values.username = adopt.settings.username.toString();
        if (adopt.settings.password)
            camera.storageSettings.values.password = adopt.settings.password.toString();

        // Now that credentials are set, probe for child devices (spotlight, siren, etc.).
        camera.refreshChildDevices().catch(e =>
            this.console.warn('post-adopt refreshChildDevices failed', e));

        return camera.id;
    }

    private async adoptIotDevice(adopt: AdoptDevice, device: KasaDiscoveredDevice, cls: KasaDeviceClass, name: string, room?: string): Promise<string> {
        const interfaces: ScryptedInterface[] = [ScryptedInterface.OnOff, ScryptedInterface.Settings];
        let type: ScryptedDeviceType;
        const caps = bulbCapabilities(device);
        // The marker we persist for getDevice routing. 'plug'/'switch' for plain on/off
        // devices, 'dimmer' for anything with brightness control, 'bulb' for true bulbs.
        let storedClass: string = cls;

        if (cls === 'bulb') {
            type = ScryptedDeviceType.Light;
            interfaces.push(ScryptedInterface.Brightness);
            if (caps.isColor)
                interfaces.push(ScryptedInterface.ColorSettingHsv);
            if (caps.isVariableColorTemp)
                interfaces.push(ScryptedInterface.ColorSettingTemperature);
        }
        else if (isDimmer(device)) {
            // Dimmer plug or dimmer switch — both expose as Light with Brightness.
            type = ScryptedDeviceType.Light;
            interfaces.push(ScryptedInterface.Brightness);
            storedClass = 'dimmer';
        }
        else {
            type = cls === 'switch' ? ScryptedDeviceType.Switch : ScryptedDeviceType.Outlet;
        }

        const sw_ver = typeof device.sysinfo?.sw_ver === 'string' ? device.sysinfo.sw_ver : undefined;
        await deviceManager.onDeviceDiscovered({
            nativeId: adopt.nativeId,
            name,
            type,
            interfaces,
            room: room || undefined,
            info: {
                manufacturer: 'TP-Link Kasa',
                model: device.model,
                mac: device.mac,
                ip: device.address,
                serialNumber: device.deviceId,
                firmware: sw_ver,
            },
        });

        // Persist the class marker so getDevice routes to the right implementation —
        // multiple device classes share the same Scrypted device type (true bulbs and
        // dimmers both register as Light).
        deviceManager.getDeviceStorage(adopt.nativeId).setItem('kasaClass', storedClass);

        const dev = await this.getDevice(adopt.nativeId);
        dev.storageSettings.values.ip = device.address;
        dev.storageSettings.values.port = KASA_IOT_PORT;
        if (cls === 'bulb' && dev instanceof KasaBulb) {
            dev.storageSettings.values.isColor = caps.isColor;
            dev.storageSettings.values.isVariableColorTemp = caps.isVariableColorTemp;
        }
        await dev.refreshState?.().catch(() => { });

        return dev.id;
    }

    // Routes a nativeId to the right device class. Adoption persists a `kasaClass` storage
    // marker (camera/plug/switch/bulb) which is the source of truth here — the Scrypted
    // device type alone is ambiguous (e.g. both true bulbs and dimmer plugs are `Light`).
    async getDevice(nativeId: string): Promise<any> {
        let dev = this.devices.get(nativeId);
        if (!dev) {
            dev = this.instantiateDevice(nativeId);
            if (!dev)
                return undefined;
            this.devices.set(nativeId, dev);
        }
        return dev;
    }

    private instantiateDevice(nativeId: string): KasaCamera | KasaPlug | KasaSwitch | KasaDimmer | KasaBulb | undefined {
        const storage = deviceManager.getDeviceStorage(nativeId);
        const kasaClass = storage?.getItem('kasaClass');
        switch (kasaClass) {
            case 'camera': return new KasaCamera(nativeId);
            case 'bulb': return new KasaBulb(nativeId);
            case 'dimmer': return new KasaDimmer(nativeId);
            case 'switch': return new KasaSwitch(nativeId);
            case 'plug': return new KasaPlug(nativeId);
        }
        // Legacy fallback for devices adopted before kasaClass added 'dimmer'. Older
        // adoptions stored a `dimmer=true` flag on the device's KasaPlug/KasaSwitch
        // storage when the underlying camera was a dimmer; promote those to KasaDimmer.
        if (storage?.getItem('dimmer') === 'true')
            return new KasaDimmer(nativeId);
        const state = deviceManager.getDeviceState(nativeId);
        switch (state?.type) {
            case ScryptedDeviceType.Camera: return new KasaCamera(nativeId);
            case ScryptedDeviceType.Switch: return new KasaSwitch(nativeId);
            case ScryptedDeviceType.Light: return new KasaDimmer(nativeId);
            case ScryptedDeviceType.Outlet: return new KasaPlug(nativeId);
        }
        return undefined;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        const dev = this.devices.get(nativeId);
        // Plug/Bulb instances run a state-poll timer that needs to be cleared.
        if (dev && 'release' in dev && typeof (dev as any).release === 'function')
            (dev as any).release();
        this.devices.delete(nativeId);
    }
}

export default KasaPlugin;
