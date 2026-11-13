import type { Resolution, RTCSignalingChannel } from '@scrypted/sdk';
import sdk, { AudioSensor, Camera, DeviceProvider, Intercom, MotionSensor, OnOff, PrivacyMode, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import { createCameraStorageSettings } from '../camera-mixin';
import { DummyDevice, addSupportedType, bindCharacteristic } from '../common';
import { AudioRecordingCodec, AudioRecordingCodecType, AudioRecordingSamplerate, AudioStreamingCodec, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController, CameraRecordingConfiguration, CameraRecordingDelegate, CameraRecordingOptions, CameraStreamingOptions, ChangeReason, Characteristic, CharacteristicEventTypes, H264Level, H264Profile, MediaContainerType, RecordingPacket, SRTPCryptoSuites, SecureVideoController, Service, VideoCodecType, WithUUID } from '../hap';
import type { HomeKitPlugin } from '../main';
import { setServiceName } from '../service-names';
import { createMultiTierRtpDelegate } from './camera/camera-multitier-rtp';
import { handleFragmentsRequests, iframeIntervalSeconds } from './camera/camera-recording';
import { createSecureVideoController, secureVideoCmafEnabled } from './camera/camera-secure-video';
import { createCameraStreamingDelegate } from './camera/camera-streaming';
import { FORCE_OPUS } from './camera/camera-utils';
import { createHomeKitWebRTCDelegate } from './camera/camera-webrtc';
import { makeAccessory, mergeOnOffDevicesByType } from './common';

const { deviceManager, systemManager } = sdk;

const numberPrebufferSegments = 1;

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera);
    },
    async getAccessory(device: ScryptedDevice & VideoCamera & VideoCameraConfiguration & Camera & MotionSensor & AudioSensor & Intercom & OnOff & PrivacyMode & Resolution, homekitPlugin: HomeKitPlugin) {
        const console = deviceManager.getMixinConsole(device.id, undefined);
        const storage = deviceManager.getMixinStorage(device.id, undefined);
        const cameraStorage = createCameraStorageSettings({ storage, onDeviceEvent: undefined });
        const secureVideo3 = cameraStorage.values.secureVideo3;
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
        if (isRecordingEnabled || secureVideo3) {
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

        const controller = secureVideo3
            ? createSecureVideoController(accessory, delegate.handleSnapshotRequest, console, recordingDelegate,
                tiers => createMultiTierRtpDelegate(device, tiers, console, storage),
                tiers => createHomeKitWebRTCDelegate(systemManager.getDeviceById<RTCSignalingChannel>(device.id), console, tiers[0]),
                device.resolution)
            : new CameraController({
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

        if (controller instanceof SecureVideoController) {
            console.log('HomeKit Secure Video 3 multi-tier RTP, SFrame WebRTC, and HDS recording enabled.');
            if (secureVideoCmafEnabled)
                console.log('HSV3 CMAF services enabled for diagnostics; clip production is not implemented.');
            // logSecureVideoRequests(accessory, controller, console);
        }

        if (controller.motionService && isRecordingEnabled) {
            const motionDevice = device;
            if (!motionDevice) {
                return;
            }

            const motionDetected = () => !!motionDevice.motionDetected;

            const { motionService } = controller;
            setServiceName(motionService, `${device.name} Motion`);
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

        // HSV3 gates streaming on its global operating mode and snapshots/recording on the recording
        // one, and configures recording without a motion sensor, so bind every one that exists.
        const operatingModeServices = [
            controller instanceof SecureVideoController ? controller.globalOperatingModeService : undefined,
            controller.recordingManagement?.operatingModeService,
        ].filter((service): service is Service => !!service);
        if (operatingModeServices.length && device.interfaces.includes(ScryptedInterface.PrivacyMode) && storage.getItem('privacyMode') === 'true')
            bindPrivacyMode(device, operatingModeServices, console);

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

/**
 * Bind HomeKitCameraActive (the camera's own on/off in the Home app, also driven by
 * the Home/Away camera modes) to the camera's privacy mode: privacy mode on means inactive.
 */
function bindPrivacyMode(device: ScryptedDevice & PrivacyMode, operatingModeServices: Service[], console: Console) {
    const characteristics = operatingModeServices.map(service => service.getCharacteristic(Characteristic.HomeKitCameraActive));

    // The value last applied, shown until the camera reports it, since its state event can trail
    // the call. Bounded in time, so a lost event can't hide later changes made elsewhere.
    let pending: boolean | undefined;
    let target: boolean | undefined;
    let pendingTimeout: NodeJS.Timeout | undefined;
    // Show the newest intended state: a queued write, then one awaiting its event, then the device.
    const isActive = () => !(target ?? pending ?? device.privacyMode);
    // Only on a real change: every update persists HAP controller state and, under HSV3, re-runs the
    // operating mode listeners.
    const sync = () => characteristics.forEach(c => {
        if (!!c.value !== isActive())
            c.updateValue(isActive());
    });
    const setPending = (value: boolean | undefined) => {
        pending = value;
        clearTimeout(pendingTimeout);
        if (value !== undefined)
            pendingTimeout = setTimeout(() => setPending(undefined), 30000);
        sync();
    };

    // Switching can be slow (a round trip to the camera), so answer HAP right away and apply in
    // the background, one change at a time, ending on the latest write. Every write is applied,
    // including the mode hubs re-send on each connection: skipping writes that look redundant
    // against the camera's possibly lagging state can drop a real change.
    let applying = false;
    let events = 0;
    const apply = async () => {
        applying = true;
        while (target !== undefined) {
            const privacyMode = target;
            target = undefined;
            const eventsBefore = events;
            const previous = pending;
            setPending(privacyMode);
            const start = Date.now();
            try {
                await device.setPrivacyMode(privacyMode);
                console.log(`privacy mode ${privacyMode ? 'on' : 'off'} (${Date.now() - start} ms)`);
                // Confirmed only by an event during the call; a cached value that matches may be stale.
                const confirmed = events !== eventsBefore && device.privacyMode === privacyMode;
                setPending(confirmed ? undefined : privacyMode);
            }
            catch (e) {
                console.error('failed to set privacy mode', e);
                // Fall back to any earlier applied value still awaiting its event.
                setPending(previous);
            }
        }
        applying = false;
    };

    for (const active of characteristics) {
        active.on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            target = !value;
            if (!applying)
                apply();
            else
                // Mirror a queued write onto the other operating mode now; HSV3 gates streaming
                // and recording separately and the in-flight call may take a while.
                sync();
        });

        // HAP restores its persisted value when controller storage loads; the camera is the source
        // of truth. Re-sync once the restore finishes, since it sets the sensors' StatusActive last.
        // The characteristic is a uint8, so compare as booleans.
        active.on(CharacteristicEventTypes.CHANGE, change => {
            if (change.reason !== ChangeReason.WRITE && !!change.newValue !== isActive())
                setImmediate(() => {
                    if (!!active.value !== isActive())
                        sync();
                });
        });
    }

    device.listen(ScryptedInterface.PrivacyMode, () => {
        events++;
        if (device.privacyMode === pending)
            setPending(undefined);
        else
            sync();
    });
    sync();
}
