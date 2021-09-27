import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

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
                "progressive_mp4", "hls", "dash", "smooth_stream"
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
})
