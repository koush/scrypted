import { Deferred } from '@scrypted/common/src/deferred';
import { listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, {
    Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, FFmpegInput, MediaObject,
    RequestMediaStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType,
    ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera,
} from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { randomBytes } from 'crypto';
import { Writable } from 'stream';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { findSpsPps, H264SpsPps, KASA_DEFAULT_PORT, KasaClient, KasaMimeG711U, KasaMimeVideo, KasaPart } from './kasa-api';

// Hard ceiling on the upfront SPS/PPS scan. Real cameras emit them well under a second; if we
// don't see them in this window the camera is misbehaving and there's no point holding the call.
const SPS_PPS_TIMEOUT_MS = 10000;

const { deviceManager, mediaManager } = sdk;

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

class KasaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, KasaCamera>();

    constructor(nativeId?: string) {
        super(nativeId);
        this.systemDevice = {
            deviceCreator: 'Kasa Camera',
        };
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                placeholder: 'Front Door, Living Room, etc.',
            },
        ];
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: ScryptedNativeId): Promise<string> {
        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.name?.toString() || 'Kasa Camera';
        await this.discoverCamera(nativeId, name);
        return nativeId;
    }

    private async discoverCamera(nativeId: string, name: string): Promise<void> {
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
        };
        await deviceManager.onDeviceDiscovered(device);
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
