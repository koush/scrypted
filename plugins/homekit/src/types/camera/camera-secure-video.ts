import { Accessory, AudioBitrate, AudioRecordingCodecType, AudioRecordingSamplerate, CameraRecordingDelegate, CameraStreamingDelegate, CameraVideoQuality, Characteristic, H264Level, H264Profile, MediaContainerType, SecureVideoController, SecureVideoVideoTier, Service, StreamTierAudioBitDepth, StreamTierAudioSampleRate, StreamTierVideoCodec, uuid, VideoCodecType } from '../../hap';
import type { createMultiTierRtpDelegate } from './camera-multitier-rtp';
import type { createHomeKitWebRTCDelegate } from './camera-webrtc';
import type { CMAFSegment } from '../../hap';

// Toggle and redeploy HomeKit to advertise the experimental CMAF services.
export const secureVideoCmafEnabled = false;

export function createSecureVideoController(accessory: Accessory,
    snapshot: CameraStreamingDelegate['handleSnapshotRequest'], console: Console,
    recordingDelegate: CameraRecordingDelegate,
    createRtpDelegate: (tiers: SecureVideoVideoTier[]) => ReturnType<typeof createMultiTierRtpDelegate>,
    createWebRTCDelegate?: (tiers: SecureVideoVideoTier[]) => ReturnType<typeof createHomeKitWebRTCDelegate>,
    resolution?: number[]) {
    const encoding = (width: number, height: number, targetAverageBitrate: number, peakBitrate: number) =>
        ({ width, height, frameRate: 30, targetAverageBitrate, peakBitrate });
    const families = [
        {
            ratio: 16 / 9,
            high: [encoding(3840, 2160, 4500, 5000), encoding(2560, 1440, 2800, 3000), encoding(1920, 1080, 1700, 1800)],
            medium: [encoding(1920, 1080, 1700, 1800), encoding(1280, 720, 768, 800)],
            low: [encoding(640, 360, 180, 190)],
        },
        {
            ratio: 4 / 3,
            high: [encoding(1600, 1200, 2800, 3000)],
            medium: [encoding(1440, 1080, 1700, 1800)],
            low: [encoding(640, 480, 180, 190), encoding(320, 240, 180, 190)],
        },
        {
            ratio: 9 / 16,
            high: [encoding(1080, 1920, 1700, 1800)],
            medium: [encoding(720, 1280, 768, 800)],
            low: [encoding(360, 640, 180, 190)],
        },
        {
            ratio: 3 / 4,
            high: [encoding(2400, 3200, 4500, 5000), encoding(1536, 2048, 2800, 3000), encoding(1200, 1600, 1700, 1800)],
            medium: [encoding(1200, 1600, 1700, 1800), encoding(960, 1280, 768, 800)],
            low: [encoding(480, 640, 180, 190)],
        },
        {
            ratio: 1,
            high: [encoding(1440, 1440, 2800, 3000)],
            medium: [encoding(1080, 1080, 1700, 1800)],
            low: [encoding(480, 480, 180, 190)],
        },
    ];

    const [width, height] = resolution?.length >= 2 && resolution.slice(0, 2).every(value => Number.isFinite(value) && value > 0)
        ? resolution : [3840, 2160];
    const aspectRatio = width / height;
    const family = families.reduce((best, family) =>
        Math.abs(family.ratio - aspectRatio) < Math.abs(best.ratio - aspectRatio) ? family : best);
    const bestFit = (candidates: ReturnType<typeof encoding>[]) => {
        const fitting = candidates.filter(tier => tier.width <= width && tier.height <= height);
        return fitting.length
            ? fitting.reduce((best, tier) => tier.width * tier.height > best.width * best.height ? tier : best)
            : candidates.reduce((best, tier) => tier.width * tier.height < best.width * best.height ? tier : best);
    };
    const high = bestFit(family.high);
    const medium = bestFit(family.medium.filter(tier => tier.width < high.width && tier.height < high.height));
    const tiers: SecureVideoVideoTier[] = [
        { ...high, identifier: 1, quality: CameraVideoQuality.HIGH },
        { ...medium, identifier: 2, quality: CameraVideoQuality.MEDIUM },
        { ...bestFit(family.low), identifier: 3, quality: CameraVideoQuality.LOW },
    ];

    const notImplemented = (operation: string): never => {
        const message = `HomeKit Secure Video 3 ${operation} is not implemented yet.`;
        console.log(message);
        throw new Error(message);
    };

    const motionService = accessory.addService(Service.MotionSensor, 'Motion Sensor');
    motionService.setCharacteristic(Characteristic.MotionDetected, false);

    const rtpDelegate = createRtpDelegate(tiers);
    const webrtcDelegate = createWebRTCDelegate?.(tiers);
    const controller = new SecureVideoController({
        sensor: {
            uuid: uuid.generate(`${accessory.UUID}:sensor`),
            width,
            height,
        },
        video: {
            codec: StreamTierVideoCodec.H265,
            payloadType: 99,
            tiers,
        },
        audio: {
            payloadType: 110,
            twoWayAudio: true,
            tier: {
                identifier: 1,
                targetAverageBitrate: 24000,
                sampleRate: StreamTierAudioSampleRate.KHZ_48,
                bitDepth: StreamTierAudioBitDepth.BITS_16,
                packetTime: 20,
                channels: 1,
            },
        },
        rtp: {
            delegate: rtpDelegate,
        },
        webrtc: {
            maxSessions: 16,
            delegate: webrtcDelegate || {
                async handleSolicitOffer() {
                    return notImplemented('WebRTC streaming');
                },
                async handleProvideAnswer() {
                    return notImplemented('WebRTC streaming');
                },
                async handleReoffer() {
                    return notImplemented('WebRTC renegotiation');
                },
                async handleUpdateSession() {
                    return notImplemented('SFrame key updates');
                },
                async handleEndSession() { },
            },
        },
        // Retain the legacy recording advertisement while the HSV3 HDS media
        // pipeline requests native HEVC/AAC. CMAF direct upload is separate.
        recording: {
            options: {
                prebufferLength: 8000,
                mediaContainerConfiguration: [{ type: MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 }],
                video: {
                    type: VideoCodecType.H264,
                    parameters: {
                        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                        profiles: [H264Profile.MAIN],
                    },
                    resolutions: [[1280, 720, 30], [1920, 1080, 30]],
                },
                audio: {
                    codecs: [{
                        type: AudioRecordingCodecType.AAC_LC,
                        bitrateMode: AudioBitrate.VARIABLE,
                        samplerate: AudioRecordingSamplerate.KHZ_32,
                        audioChannels: 1,
                    }],
                },
            },
            delegate: recordingDelegate,
        },
        // Advertise CMAF for observing hub provisioning and motion-triggered
        // commands. Clip production remains deliberately unimplemented.
        ingest: secureVideoCmafEnabled ? {
            delegate: {
                async *streamClip(request): AsyncGenerator<CMAFSegment> {
                    console.log('HSV3 CMAF streamClip:', {
                        cmafSessionId: request.cmafSessionId.toString(),
                        command: request.command.command,
                        start: request.command.start?.toString(),
                        stop: request.command.stop?.toString(),
                        stopAction: request.command.stopAction,
                        aborted: request.signal.aborted,
                    });
                    notImplemented('CMAF clip production');
                },
                handleBufferActivity(request) {
                    console.log('HSV3 CMAF buffer activity (buffer management not implemented):', {
                        start: request.start.toString(),
                        durationMs: request.duration.toString(),
                        activity: request.activity,
                    });
                },
                updateRecordingActive(active, audioActive) {
                    console.log('HSV3 CMAF recording active:', { active, audioActive });
                },
                updatePublishingPoint(publishingPoint) {
                    console.log('HSV3 CMAF publishing point:', {
                        configured: !!publishingPoint,
                        serverCACertificateCount: publishingPoint?.serverCACertificates.length ?? 0,
                    });
                },
                updateClientCertificate(installed) {
                    console.log('HSV3 CMAF client certificate:', { installed });
                },
                handleUploadResult(cmafSessionId, error, detail) {
                    console.log('HSV3 CMAF upload result:', { cmafSessionId: cmafSessionId.toString(), error, detail });
                },
            },
        } : undefined,
        motionService,
        snapshot(request) {
            return new Promise((resolve, reject) => {
                snapshot(request || { width: tiers[0].width, height: tiers[0].height }, (error, image) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(image);
                    }
                });
            });
        },
    });
    if (webrtcDelegate)
        webrtcDelegate.onSessionEnded = id => controller.endWebRTCSession(id);
    // Stop live media immediately when the controller's privacy/streaming gates close.
    const configureServices = controller.configureServices.bind(controller);
    controller.configureServices = () => {
        configureServices();
        controller.multiTierStreamManagementService.getCharacteristic(Characteristic.StatusActive)
            .on('change', change => { if (!change.newValue) rtpDelegate.stopAll(); });
        const checkWebRTCStreaming = () => {
            if (!controller.streamingAllowed(controller.webrtcStreamManagementService)) {
                for (const id of controller.activeWebRTCSessions)
                    controller.endWebRTCSession(id).catch(() => console.log('HSV3 WebRTC cleanup failed'));
            }
        };
        controller.webrtcStreamManagementService.getCharacteristic(Characteristic.StreamingEnabled)
            .on('change', checkWebRTCStreaming);
        for (const characteristic of [Characteristic.HomeKitCameraActive, Characteristic.StreamingEnabled, Characteristic.ManuallyDisabled]) {
            if (controller.globalOperatingModeService?.testCharacteristic(characteristic))
                controller.globalOperatingModeService.getCharacteristic(characteristic).on('change', checkWebRTCStreaming);
        }
    };
    const remove = controller.handleControllerRemoved.bind(controller);
    controller.handleControllerRemoved = () => {
        rtpDelegate.stopAll();
        webrtcDelegate?.stopAll();
        remove();
    };
    return controller;
}
