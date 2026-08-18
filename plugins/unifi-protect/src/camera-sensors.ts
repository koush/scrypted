export const MOTION_SENSOR_TIMEOUT = 25000;
export const FINGERPRINT_SENSOR_TIMEOUT = 5000;

export interface UnifiMotionDevice {
    motionTimeout: NodeJS.Timeout;
    setMotionDetected(motionDetected: boolean): void;
}

export interface UnifiFingerprintDevice {
    fingerprintTimeout: NodeJS.Timeout;
    setFingerprintDetected(fingerprintDetected: boolean): void;
}

export function isSmartDetectionEvent(eventType: string) {
    return eventType === 'smartDetectZone' || eventType === 'smartDetectLine';
}

export function shouldTriggerMotionFromEvent(eventType: string, smartDetectionAsMotion: boolean) {
    return eventType === 'motion' || (smartDetectionAsMotion && isSmartDetectionEvent(eventType));
}

export function handleMotionEvent(device: UnifiMotionDevice, eventType: string, smartDetectionAsMotion: boolean) {
    if (!shouldTriggerMotionFromEvent(eventType, smartDetectionAsMotion))
        return false;

    debounceMotionDetected(device);
    return true;
}

export function debounceMotionDetected(device: UnifiMotionDevice) {
    device.setMotionDetected(true);
    clearTimeout(device.motionTimeout);
    device.motionTimeout = setTimeout(() => {
        device.setMotionDetected(false);
    }, MOTION_SENSOR_TIMEOUT);
}

export function debounceFingerprintDetected(device: UnifiFingerprintDevice) {
    device.setFingerprintDetected(true);
    clearTimeout(device.fingerprintTimeout);
    device.fingerprintTimeout = setTimeout(() => {
        device.setFingerprintDetected(false);
    }, FINGERPRINT_SENSOR_TIMEOUT);
}
