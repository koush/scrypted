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
    createWebRTCDelegate?: (tiers: SecureVideoVideoTier[]) => ReturnType<typeof createHomeKitWebRTCDelegate>) {
    // Advertise supported HomeKit video tiers across resolutions and aspect ratios.
    const tiers: SecureVideoVideoTier[] = [
        { identifier: 1, quality: CameraVideoQuality.HIGHEST, width: 3840, height: 2160, frameRate: 30, targetAverageBitrate: 4500, peakBitrate: 5000 },
        { identifier: 2, quality: CameraVideoQuality.HIGHEST, width: 3840, height: 2160, frameRate: 24, targetAverageBitrate: 4500, peakBitrate: 5000 },
        { identifier: 3, quality: CameraVideoQuality.HIGH, width: 2560, height: 1440, frameRate: 30, targetAverageBitrate: 2800, peakBitrate: 3000 },
        { identifier: 4, quality: CameraVideoQuality.HIGH, width: 1920, height: 1080, frameRate: 30, targetAverageBitrate: 1700, peakBitrate: 1800 },
        { identifier: 5, quality: CameraVideoQuality.MEDIUM, width: 1920, height: 1080, frameRate: 30, targetAverageBitrate: 1700, peakBitrate: 1800 },
        { identifier: 6, quality: CameraVideoQuality.MEDIUM, width: 1280, height: 720, frameRate: 30, targetAverageBitrate: 768, peakBitrate: 800 },
        { identifier: 7, quality: CameraVideoQuality.LOW, width: 640, height: 360, frameRate: 30, targetAverageBitrate: 180, peakBitrate: 190 },
        { identifier: 8, quality: CameraVideoQuality.LOW, width: 640, height: 360, frameRate: 15, targetAverageBitrate: 180, peakBitrate: 190 },
        { identifier: 9, quality: CameraVideoQuality.LOW, width: 320, height: 240, frameRate: 30, targetAverageBitrate: 180, peakBitrate: 190 },
        { identifier: 10, quality: CameraVideoQuality.HIGH, width: 1600, height: 1200, frameRate: 30, targetAverageBitrate: 2800, peakBitrate: 3000 },
        { identifier: 11, quality: CameraVideoQuality.MEDIUM, width: 1440, height: 1080, frameRate: 30, targetAverageBitrate: 1700, peakBitrate: 1800 },
        { identifier: 12, quality: CameraVideoQuality.LOW, width: 640, height: 480, frameRate: 30, targetAverageBitrate: 180, peakBitrate: 190 },
        { identifier: 13, quality: CameraVideoQuality.HIGH, width: 1080, height: 1920, frameRate: 30, targetAverageBitrate: 1700, peakBitrate: 1800 },
        { identifier: 14, quality: CameraVideoQuality.LOW, width: 360, height: 640, frameRate: 30, targetAverageBitrate: 180, peakBitrate: 190 },
        { identifier: 15, quality: CameraVideoQuality.HIGH, width: 1440, height: 1440, frameRate: 30, targetAverageBitrate: 2800, peakBitrate: 3000 },
        { identifier: 16, quality: CameraVideoQuality.LOW, width: 480, height: 480, frameRate: 30, targetAverageBitrate: 180, peakBitrate: 190 },
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
            width: tiers[0].width,
            height: tiers[0].height,
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
                sampleRate: StreamTierAudioSampleRate.KHZ_16,
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
