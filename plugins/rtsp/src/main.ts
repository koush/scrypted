import { RtspProvider } from "./rtsp";

export default class RTSPCameraProvider extends RtspProvider {
    getScryptedDeviceCreator(): string {
        return 'RTSP Camera';
    }
}
