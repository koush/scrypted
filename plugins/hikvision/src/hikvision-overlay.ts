export interface VideoOverlayRoot {
    VideoOverlay: VideoOverlay;
}

export interface VideoOverlay {
    $:                    VideoOverlayClass;
    normalizedScreenSize: NormalizedScreenSize[];
    attribute:            Attribute[];
    fontSize:             string[];
    TextOverlayList:      TextOverlayListElement[];
    DateTimeOverlay:      DateTimeOverlay[];
    channelNameOverlay:   ChannelNameOverlay[];
    frontColorMode:       string[];
    frontColor:           string[];
    alignment:            string[];
    boundary:             string[];
    upDownboundary:       string[];
    leftRightboundary:    string[];
}

export interface VideoOverlayClass {
    version: string;
    xmlns:   string;
}

export interface DateTimeOverlay {
    enabled:     string[];
    positionX:   string[];
    positionY:   string[];
    dateStyle:   string[];
    timeStyle:   string[];
    displayWeek: string[];
}

export interface TextOverlayListElement {
    $:           TextOverlayList;
    TextOverlay: TextOverlay[];
}

export interface TextOverlayList {
    size: string;
}

export interface TextOverlay {
    id:               string[];
    enabled:          string[];
    positionX:        string[];
    positionY:        string[];
    displayText:      string[];
    isPersistentText: string[];
}

export interface Attribute {
    transparent: string[];
    flashing:    string[];
}

export interface ChannelNameOverlay {
    $:         VideoOverlayClass;
    enabled:   string[];
    positionX: string[];
    positionY: string[];
}

export interface NormalizedScreenSize {
    normalizedScreenWidth:  string[];
    normalizedScreenHeight: string[];
}


export interface TextOverlayRoot {
    TextOverlay: TextOverlay;
}

export interface TextOverlay {
    $:           Empty;
    id:          string[];
    enabled:     string[];
    positionX:   string[];
    positionY:   string[];
    displayText: string[];
    directAngle: string[];
}

export interface Empty {
    version: string;
    xmlns:   string;
}

export interface PtzPresetsRoot {
    PTZPresetList: PTZPresetList;
}

export interface PTZPresetList {
    PTZPreset: PTZPreset[];
    _xmlns:    string;
    _version:  string;
}

export interface PTZPreset {
    enabled:      string;
    id:           string;
    presetName:   string;
    AbsoluteHigh: AbsoluteHigh;
}

export interface AbsoluteHigh {
    elevation:    string;
    azimuth:      string;
    absoluteZoom: string;
}

