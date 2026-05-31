import { Deferred } from '@scrypted/common/src/deferred';
import sdk, { AudioSensor, Camera, DeviceProvider, Intercom, MotionSensor, OnOff, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import { DummyDevice, addSupportedType, bindCharacteristic } from '../common';
import { AudioRecordingCodec, AudioRecordingCodecType, AudioRecordingSamplerate, AudioStreamingCodec, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController, CameraRecordingConfiguration, CameraRecordingDelegate, CameraRecordingOptions, CameraStreamingOptions, Characteristic, CharacteristicEventTypes, H264Level, H264Profile, MediaContainerType, RecordingPacket, SRTPCryptoSuites, Service, VideoCodecType, WithUUID } from '../hap';
import type { HomeKitPlugin } from '../main';
import { handleFragmentsRequests, iframeIntervalSeconds } from './camera/camera-recording';
import { createCameraStreamingDelegate } from './camera/camera-streaming';
import { FORCE_OPUS } from './camera/camera-utils';
import { makeAccessory, mergeOnOffDevicesByType } from './common';

const { deviceManager, systemManager } = sdk;

const numberPrebufferSegments = 1;

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera);
    },
    async getAccessory(device: ScryptedDevice & VideoCamera & VideoCameraConfiguration & Camera & MotionSensor & AudioSensor & Intercom & OnOff, homekitPlugin: HomeKitPlugin) {
        const console = deviceManager.getMixinConsole(device.id, undefined);
        const storage = deviceManager.getMixinStorage(device.id, undefined);
        const twoWayAudio = device.interfaces?.includes(ScryptedInterface.Intercom);

        const forceOpus = FORCE_OPUS;

        const codecs: AudioStreamingCodec[] = [];
        // homekit seems to prefer AAC_ELD if it is offered.
        // so forcing opus must be done by not offering AAC_ELD.
        const enabledStreamingCodecTypes = [
            AudioStreamingCodecType.OPUS,
        ];
        if (!forceOpus) {
            enabledStreamingCodecTypes.push(AudioStreamingCodecType.AAC_ELD);
        }
        for (const type of enabledStreamingCodecTypes) {
            for (const samplerate of [
                // required by watch
                AudioStreamingSamplerate.KHZ_8,
                // never seen this requested
                AudioStreamingSamplerate.KHZ_16,
                // requested (required?) by ios/mac.
                AudioStreamingSamplerate.KHZ_24
            ]) {
                codecs.push({
                    type,
                    samplerate,
                    // AudioBitrate.VARIABLE
                    bitrate: 0,
                    audioChannels: 1,
                });
                codecs.push({
                    type,
                    samplerate,
                    // AudioBitrate.CONSTANT
                    bitrate: 1,
                    audioChannels: 1,
                });
            }
        }

        const streamingOptions: CameraStreamingOptions = {
            video: {
                codec: {
                    levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                    profiles: [H264Profile.MAIN],
                },

                // HomeKit will request a resolution from this list, but it seems to do it
                // stupidly. For example, local network macOS on a 6k monitor requests the 480p stream?
                // so using the resolution for device fingerprinting can't be trusted.
                resolutions: [
                    // 3840x2160@30 (4k).
                    [3840, 2160, 30],
                    // 3K
                    [2880, 1620, 30],
                    // 2MP
                    [2560, 1440, 30],
                    // 1920x1080@30 (1080p).
                    [1920, 1080, 30],
                    // 1280x720@30 (720p).
                    [1280, 720, 30],
                    [960, 540, 30],
                    [640, 360, 30],
                    // 320x240@15 (Apple Watch).
                    [320, 240, 15],
                ]
            },
            audio: {
                codecs,
                twoWayAudio,
            },
            supportedCryptoSuites: [
                // not supported by ffmpeg
                // SRTPCryptoSuites.AES_CM_256_HMAC_SHA1_80,
                SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80,
                SRTPCryptoSuites.NONE,
            ]
        }

        let recordingDelegate: CameraRecordingDelegate | undefined;
        let recordingOptions: CameraRecordingOptions | undefined;

        const accessory = makeAccessory(device, homekitPlugin);

        const isRecordingEnabled = device.interfaces.includes(ScryptedInterface.MotionSensor);

        let configuration: CameraRecordingConfiguration;
        const openRecordingStreams = new Map<number, AsyncGenerator<RecordingPacket>>();
        if (isRecordingEnabled) {
            recordingDelegate = {
                updateRecordingConfiguration(newConfiguration: CameraRecordingConfiguration) {
                    configuration = newConfiguration;
                },
                handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {
                    const ret = handleFragmentsRequests(streamId, device, configuration, console, homekitPlugin, 
                        () => openRecordingStreams.has(streamId));
                    openRecordingStreams.set(streamId, ret);
                    return ret;
                },
                closeRecordingStream(streamId, reason) {
                    const r = openRecordingStreams.get(streamId);
                    console.log(`motion recording closed ${reason > 0 ? `(error code: ${reason})` : ''}`);
                    openRecordingStreams.delete(streamId);
                },
                updateRecordingActive(active) {
                },
            };

            const recordingCodecs: AudioRecordingCodec[] = [];
            const samplerate: AudioRecordingSamplerate[] = [];
            for (const sr of [
                // i believe more options may be causing issues with recordings
                // (see other half of change).
                // AudioRecordingSamplerate.KHZ_8,
                // AudioRecordingSamplerate.KHZ_16,
                // AudioRecordingSamplerate.KHZ_24,
                AudioRecordingSamplerate.KHZ_32,
                // AudioRecordingSamplerate.KHZ_44_1,
                // AudioRecordingSamplerate.KHZ_48,
            ]) {
                samplerate.push(sr);
            }

            // homekit seems to prefer AAC_ELD if it is offered.
            // so forcing AAC_LC must be done by not offering AAC_ELD.
            const enabledRecordingCodecTypes = [
                AudioRecordingCodecType.AAC_LC,
            ];
            if (!forceOpus) {
                enabledRecordingCodecTypes.push(AudioRecordingCodecType.AAC_ELD);
            }
            for (const type of enabledRecordingCodecTypes) {
                const entry: AudioRecordingCodec = {
                    type,
                    bitrateMode: 0,
                    samplerate,
                    audioChannels: 1,
                }
                recordingCodecs.push(entry);
            }

            // const recordingResolutions = [...nativeResolutions];
            // ensureHasWidthResolution(recordingResolutions, 1280, 720);
            // ensureHasWidthResolution(recordingResolutions, 1920, 1080);

            recordingOptions = {
                prebufferLength: numberPrebufferSegments * iframeIntervalSeconds * 1000,
                mediaContainerConfiguration: [
                    {
                        type: MediaContainerType.FRAGMENTED_MP4,
                        fragmentLength: iframeIntervalSeconds * 1000,
                    }
                ],
                video: {
                    type: VideoCodecType.H264,
                    parameters: {
                        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                        profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
                    },
                    resolutions: [
                        [1280, 720, 30],
                        [1920, 1080, 30],
                    ],
                },
                audio: {
                    codecs: recordingCodecs,
                },
            };
        }

        const delegate = createCameraStreamingDelegate(device, console, storage, homekitPlugin);

        const controller = new CameraController({
            cameraStreamCount: 8,
            delegate,
            streamingOptions,
            recording: !isRecordingEnabled ? undefined : {
                options: recordingOptions,
                delegate: recordingDelegate,
            },
            sensors: {
                motion: isRecordingEnabled,
            },
        });

        accessory.configureController(controller);

        if (controller.motionService) {
            const motionDevice = device;
            if (!motionDevice) {
                return;
            }

            const motionDetected = () => !!motionDevice.motionDetected;

            const { motionService } = controller;
            bindCharacteristic(motionDevice,
                ScryptedInterface.MotionSensor,
                motionService,
                Characteristic.MotionDetected,
                () => motionDetected(), true)

            const { recordingManagement } = controller;

            const persistBooleanCharacteristic = (service: Service, characteristic: WithUUID<{ new(): Characteristic }>) => {
                const property = `characteristic-v2-${characteristic.UUID}`
                service.getCharacteristic(characteristic)
                    .on(CharacteristicEventTypes.GET, callback => callback(null, storage.getItem(property) === 'true' ? 1 : 0))
                    .removeOnSet()
                    .on(CharacteristicEventTypes.SET, (value, callback) => {
                        callback();
                        storage.setItem(property, (!!value).toString());
                    });
            }

            if (!device.interfaces.includes(ScryptedInterface.OnOff)) {
                persistBooleanCharacteristic(recordingManagement.operatingModeService, Characteristic.CameraOperatingModeIndicator);
            }
            else {
                const indicator = recordingManagement.operatingModeService.getCharacteristic(Characteristic.CameraOperatingModeIndicator);
                const linkStatusIndicator = storage.getItem('statusIndicator') === 'true';
                const property = `characteristic-v2-${Characteristic.CameraOperatingModeIndicator.UUID}`
                bindCharacteristic(device, ScryptedInterface.OnOff, recordingManagement.operatingModeService, Characteristic.CameraOperatingModeIndicator, () => {
                    if (!linkStatusIndicator)
                        return storage.getItem(property) === 'true' ? 1 : 0;

                    return device.on ? 1 : 0;
                });
                indicator.on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    if (!linkStatusIndicator)
                        return storage.setItem(property, (!!value).toString());

                    if (value)
                        device.turnOn();
                    else
                        device.turnOff();
                });
            }
        }

        // if the camera is a device provider, merge in child devices and 
        // ensure the devices are skipped by the rest of homekit by
        // reporting that they've been merged
        if (device.interfaces.includes(ScryptedInterface.DeviceProvider)) {
            // merge in lights
            mergeOnOffDevicesByType(device as ScryptedDevice as ScryptedDevice & DeviceProvider, accessory, ScryptedDeviceType.Light).devices.forEach(device => {
                homekitPlugin.mergedDevices.add(device.id)
            });

            // merge in sirens
            mergeOnOffDevicesByType(device as ScryptedDevice as ScryptedDevice & DeviceProvider, accessory, ScryptedDeviceType.Siren).devices.forEach(device => {
                homekitPlugin.mergedDevices.add(device.id)
            });
        }

        return accessory;
    }
});
