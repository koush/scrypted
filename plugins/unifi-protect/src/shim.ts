
export interface FeatureFlagsShim {
    hasFingerprintSensor: boolean;
}

export interface PrivacyZone {
    id: number;
    name: string;
    color: string;
    points: [number, number][];
}
