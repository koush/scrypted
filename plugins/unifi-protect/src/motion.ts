export const MOTION_SENSOR_TIMEOUT = 25000;

export interface UnifiMotionDevice {
    motionTimeout: NodeJS.Timeout;
    setMotionDetected(motionDetected: boolean): void;
}

export function debounceMotionDetected(device: UnifiMotionDevice) {
    device.setMotionDetected(true);
    clearTimeout(device.motionTimeout);
    device.motionTimeout = setTimeout(() => {
        device.setMotionDetected(false);
    }, MOTION_SENSOR_TIMEOUT);
}
