import { Accessory, Characteristic, CharacteristicEventTypes, decodeBufferActivityCommand, decodeBufferEventCommand, decodeBufferUploadCommand, SecureVideoController, Service } from '../../hap';

// Trace the HAP boundary, since the controller can reject a request before invoking
// a media delegate. Only allowlisted public capability TLVs may be logged:
// stream setup and session updates include encryption keys.
export function logSecureVideoRequests(accessory: Accessory, controller: SecureVideoController, console: Console) {
    const state = () => ({
        cameraActive: controller.homeKitCameraActive,
        rtpAllowed: controller.streamingAllowed(controller.multiTierStreamManagementService),
        webrtcAllowed: controller.streamingAllowed(controller.webrtcStreamManagementService),
        recordingCameraActive: controller.recordingManagement?.operatingModeService.getCharacteristic(Characteristic.HomeKitCameraActive).value,
        eventSnapshotsActive: controller.recordingManagement?.operatingModeService.getCharacteristic(Characteristic.EventSnapshotsActive).value,
        periodicSnapshotsActive: controller.recordingManagement?.operatingModeService.getCharacteristic(Characteristic.PeriodicSnapshotsActive).value,
        recordingActive: controller.recordingActive,
        recordingAudioActive: controller.recordingAudioActive,
    });

    const stateCharacteristics = new Set([
        Characteristic.HomeKitCameraActive.UUID,
        Characteristic.StreamingEnabled.UUID,
        Characteristic.EventSnapshotsActive.UUID,
        Characteristic.PeriodicSnapshotsActive.UUID,
    ]);

    const publicValues = new Set([
        Characteristic.CameraCapabilitiesConfiguration.UUID,
        Characteristic.Version.UUID,
        Characteristic.SensorUUID.UUID,
        Characteristic.SupportedVideoStreamTiers.UUID,
        Characteristic.SupportedAudioStreamTiers.UUID,
        Characteristic.SupportedRTPConfiguration.UUID,
        Characteristic.WebRTCSupportedVideoStreamTiers.UUID,
        Characteristic.WebRTCSupportedAudioStreamTiers.UUID,
        Characteristic.SupportedCameraRecordingConfiguration.UUID,
        Characteristic.SupportedVideoRecordingConfiguration.UUID,
        Characteristic.SupportedAudioRecordingConfiguration.UUID,
        Characteristic.SelectedCameraRecordingConfiguration.UUID,
        Characteristic.SupportedDataStreamTransportConfiguration.UUID,
        Characteristic.ContributingSensors.UUID,
    ]);

    for (const service of accessory.services) {
        if (service.UUID === Service.AccessoryInformation.UUID)
            continue;

        // Capture the actual /accessories representation, after outgoing-value
        // formatting and IID assignment. Merely tracing getters misses both.
        const toHAP = service.toHAP.bind(service);
        const discoveryPeers = new Set<string>();
        service.toHAP = async (...args) => {
            const result = await toHAP(...args);
            const peer = args[0]?.remoteAddress || 'unknown';
            if (!discoveryPeers.has(peer)) {
                discoveryPeers.add(peer);
                const characteristics = result.characteristics.map(value => {
                    const characteristic = service.characteristics.find(c => c.iid === value.iid);
                    const isPublic = publicValues.has(characteristic?.UUID)
                        || typeof value.value === 'boolean' || typeof value.value === 'number';
                    return { ...value, value: isPublic ? value.value : undefined };
                });
                console.log('HSV3 discovery:', peer, JSON.stringify({ ...result, characteristics }));
            }
            return result;
        };

        for (const characteristic of service.characteristics) {
            const label = `${service.displayName || service.UUID} / ${characteristic.displayName}`;
            let read = false;
            const get = characteristic.handleGetRequest.bind(characteristic);
            characteristic.handleGetRequest = async (...args) => {
                // Capability polling can be frequent; the first read establishes discovery.
                if (!read) {
                    read = true;
                    console.log('HSV3 HAP read:', label);
                }
                try {
                    return await get(...args);
                }
                catch (error) {
                    console.log('HSV3 HAP read rejected:', label, error);
                    throw error;
                }
            };

            const set = characteristic.handleSetRequest.bind(characteristic);
            characteristic.handleSetRequest = async (...args) => {
                console.log('HSV3 HAP write:', args[1]?.remoteAddress, label, JSON.stringify(state()));
                // These commands contain IDs/timestamps, not keys or publishing
                // credentials. Log before dispatch, including STOP and requests
                // rejected by ingest before streamClip can be invoked.
                try {
                    const decoder = characteristic.UUID === Characteristic.BufferUploadCommand.UUID ? decodeBufferUploadCommand
                        : characteristic.UUID === Characteristic.BufferActivityCommand.UUID ? decodeBufferActivityCommand
                            : characteristic.UUID === Characteristic.BufferEventCommand.UUID ? decodeBufferEventCommand : undefined;
                    if (decoder) {
                        const command = decoder(Buffer.from(String(args[0]), 'base64'));
                        console.log('HSV3 CMAF HAP command:', characteristic.displayName,
                            JSON.stringify(command, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
                    }
                }
                catch (error) {
                    console.log('HSV3 CMAF command decode failed:', characteristic.displayName, error);
                }
                try {
                    const response = await set(...args);
                    // A successful HAP write can still contain a protocol-level error TLV.
                    console.log('HSV3 HAP write handled:', label, JSON.stringify(state()));
                    return response;
                }
                catch (error) {
                    console.log('HSV3 HAP write rejected:', label, error);
                    throw error;
                }
            };

            if (stateCharacteristics.has(characteristic.UUID)) {
                characteristic.on(CharacteristicEventTypes.CHANGE, () => {
                    console.log('HSV3 operating mode changed:', label, state());
                });
            }
        }
    }

    const snapshot = controller.handleSnapshotRequest.bind(controller);
    controller.handleSnapshotRequest = async (...args) => {
        console.log('HSV3 HAP snapshot request:', state());
        try {
            return await snapshot(...args);
        }
        catch (error) {
            console.log('HSV3 HAP snapshot rejected:', error, state());
            throw error;
        }
    };

    accessory.on('listening', () => console.log('HSV3 published state:', JSON.stringify(state())));
}
