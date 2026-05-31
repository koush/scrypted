import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, queryResponse, syncResponse } from '../common';

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device) {
        return device.interfaces.includes(ScryptedInterface.RTCSignalingChannel);
    },
    async getSyncResponse(device) {
        const ret = syncResponse(device, 'action.devices.types.CAMERA');
        ret.traits.push('action.devices.traits.CameraStream');
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
})
