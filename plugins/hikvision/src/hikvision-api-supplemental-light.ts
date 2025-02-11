export interface SupplementLightRoot {
    SupplementLight: SupplementLight;
}

export interface SupplementLight {
    mode: string[];
    Schedule?: Schedule[];
    brightnessLimit: BrightnessLimit[];
    supplementLightMode: string[];
    irLightBrightness?: LightBrightness[];
    mixedLightBrightnessRegulatMode?: string[];
    highIrLightBrightness?: LightBrightness[];
    highWhiteLightBrightness?: LightBrightness[];
    lowIrLightBrightness?: LightBrightness[];
    lowWhiteLightBrightness?: LightBrightness[];
    whiteLightBrightness?: LightBrightness[];
}

export interface Schedule {
    TimeRange: TimeRange[];
}

export interface TimeRange {
    beginTime: string[];
    endTime: string[];
}

export interface BrightnessLimit {
    _: string;
    $: {
        min: string;
        max: string;
    };
}

export interface LightBrightness { 
    _: string;
    $: {
        min: string;
        max: string;
    };
}
