import sdk, { BinarySensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

const { systemManager } = sdk;

addSupportedType({
    type: ScryptedDeviceType.Doorbell,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera) && device.interfaces.includes(ScryptedInterface.BinarySensor);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.DOORBELL');
        ret.traits.push('action.devices.traits.CameraStream');
        ret.traits.push('action.devices.traits.ObjectDetection');
        ret.attributes = {
            cameraStreamSupportedProtocols: [
                // this may be supported on gen 2 hub?
                "progressive_mp4",
                // "hls",
                // "dash",
                // "smooth_stream",
                "webrtc",
            ],
            cameraStreamNeedAuthToken: true,
            cameraStreamNeedDrmEncryption: false
        }
        return ret;
    },
    async query(device: ScryptedDevice) {
        const ret = queryResponse(device);
        return ret;
    },
    async notifications(device: ScryptedDevice & BinarySensor, interfaces: Set<string>) {
        if (!interfaces?.has(ScryptedInterface.BinarySensor) || !device.binaryState)
            return {};

        const ret = {
            ObjectDetection: {
                objects: {
                    "unfamiliar": 1
                },
                priority: 0,
                detectionTimestamp: Date.now(),
            }
        }
        return ret;
    }
})
