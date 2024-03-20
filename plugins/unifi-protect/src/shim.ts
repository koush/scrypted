
export interface FeatureFlagsShim {
    hasPackageCamera: boolean;
}

export interface LastSeenShim {
    lastSeen: number;
}

export interface PrivacyZone {
    id: number;
    name: string;
    color: string;
    points: [number, number][];
}
