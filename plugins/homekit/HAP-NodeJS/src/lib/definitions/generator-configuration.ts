import assert from "assert";
import { Access } from "../Characteristic";
import { GeneratedCharacteristic, GeneratedService } from "./generate-definitions";

const enum PropertyId {
  NOTIFY = 0x01,
  READ = 0x02,
  WRITE = 0x04,
  BROADCAST = 0x08, // BLE
  ADDITIONAL_AUTHORIZATION = 0x10,
  TIMED_WRITE = 0x20,
  HIDDEN = 0x40,
  WRITE_RESPONSE = 0x80,
}

export const CharacteristicHidden: Set<string> = new Set([
  "service-signature", // BLE
]);

export const CharacteristicNameOverrides: Map<string, string> = new Map([
  ["air-quality", "Air Quality"],
  ["app-matching-identifier", "App Matching Identifier"],
  ["cloud-relay.control-point", "Relay Control Point"],
  ["cloud-relay.current-state", "Relay State"],
  ["cloud-relay.enabled", "Relay Enabled"],
  ["density.voc", "VOC Density"],
  ["filter.reset-indication", "Reset Filter Indication"], // Filter Reset Change Indication
  ["light-level.current", "Current Ambient Light Level"],
  ["network-client-control", "Network Client Profile Control"],
  ["on", "On"],
  ["selected-stream-configuration", "Selected RTP Stream Configuration"],
  ["service-label-index", "Service Label Index"],
  ["service-label-namespace", "Service Label Namespace"],
  ["setup-stream-endpoint", "Setup Endpoints"],
  ["snr", "Signal To Noise Ratio"],
  ["supported-target-configuration", "Target Control Supported Configuration"],
  ["target-list", "Target Control List"],
  ["tunneled-accessory.advertising", "Tunneled Accessory Advertising"],
  ["tunneled-accessory.connected", "Tunneled Accessory Connected"],
  ["water-level", "Water Level"],
]);

export const CharacteristicDeprecatedNames: Map<string, string> = new Map([ // keep in mind that the displayName will change
]);

export const CharacteristicValidValuesOverride: Map<string, Record<string, string>> = new Map([
  ["closed-captions", { "0": "Disabled", "1": "Enabled" }],
  ["input-device-type", { "0": "Other", "1": "TV", "2": "Recording", "3": "Tuner", "4": "Playback", "5": "Audio System"}],
  ["input-source-type", { "0": "Other", "1": "Home Screen", "2": "Tuner", "3": "HDMI", "4": "Composite Video", "5": "S Video",
    "6": "Component Video", "7": "DVI", "8": "AirPlay", "9": "USB", "10": "Application" }],
  ["managed-network-enable", { "0": "Disabled", "1": "Enabled" }],
  ["manually-disabled", { "0": "Enabled", "1": "Disabled" }],
  ["media-state.current", { "0": "Play", "1": "Pause", "2": "Stop", "4": "LOADING", "5": "Interrupted" }],
  ["media-state.target", { "0": "Play", "1": "Pause", "2": "Stop" }],
  ["picture-mode", { "0": "Other", "1": "Standard", "2": "Calibrated", "3": "Calibrated Dark", "4": "Vivid", "5": "Game", "6": "Computer", "7": "Custom" }],
  ["power-mode-selection", { "0": "Show", "1": "Hide" }],
  ["recording-audio-active", { "0": "Disable", "1": "Enable"}],
  ["remote-key", { "0": "Rewind", "1": "Fast Forward", "2": "Next Track", "3": "Previous Track", "4": "Arrow Up", "5": "Arrow Down",
    "6": "Arrow Left", "7": "Arrow Right", "8": "Select", "9": "Back", "10": "Exit", "11": "Play Pause", "15": "Information" }],
  ["router-status", { "0": "Ready", "1": "Not Ready" }],
  ["siri-input-type", { "0": "Push Button Triggered Apple TV"}],
  ["sleep-discovery-mode", { "0": "Not Discoverable", "1": "Always Discoverable" }],
  ["visibility-state.current", { "0": "Shown", "1": "Hidden" }],
  ["visibility-state.target", { "0": "Shown", "1": "Hidden" }],
  ["volume-control-type", { "0": "None", "1": "Relative", "2": "Relative With Current", "3": "Absolute" }],
  ["volume-selector", { "0": "Increment", "1": "Decrement" }],
  ["wifi-satellite-status", { "0": "Unknown", "1": "Connected", "2": "Not Connected" }],
] as [string, Record<string, string>][]);

export const CharacteristicClassAdditions: Map<string, string[]> = new Map([
  ["humidifier-dehumidifier.state.target", ["/**\n   * @deprecated Removed in iOS 11. Use {@link HUMIDIFIER_OR_DEHUMIDIFIER} instead.\n   */\n  public static readonly AUTO = 0;"]]
]);

export const CharacteristicOverriding: Map<string, (generated: GeneratedCharacteristic) => void> = new Map([
  ["rotation.speed", generated => {
    generated.units = "percentage";
  }],
  ["temperature.current", generated => {
    generated.minValue = -270;
  }],
  ["characteristic-value-transition-control", generated => {
    generated.properties |= PropertyId.WRITE_RESPONSE;
  }],
  ["setup-data-stream-transport", generated => {
    generated.properties |= PropertyId.WRITE_RESPONSE;
  }],
  ["data-stream-hap-transport", generated => {
    generated.properties |= PropertyId.WRITE_RESPONSE;
  }],
  ["lock-mechanism.last-known-action", generated => {
    assert(generated.maxValue === 8, "LockLastKnownAction seems to have changed in metadata!");
    generated.maxValue = 10;
    generated.validValues!["9"] = "SECURED_PHYSICALLY";
    generated.validValues!["10"] = "UNSECURED_PHYSICALLY";
  }],
  ["configured-name", generated => {
    // the write permission on the configured name characteristic is actually optional and should only be supported
    // if a HomeKit controller should be able to change the name (e.g. for a TV Input).
    // As of legacy compatibility we just add that permission and tackle that problem later in a TVController (or something).
    generated.properties |= PropertyId.WRITE;
  }],
  ["is-configured", generated => {
    // write permission on is configured is optional (out of history it was present with HAP-NodeJS)
    // if the HomeKit controller is able to change the configured state, it can be set to write.
    generated.properties |= PropertyId.WRITE;
  }],
  ["display-order", generated => {
    // write permission on display order is optional (out of history it was present with HAP-NodeJS)
    // if the HomeKit controller is able to change the configured state, it can be set to write.
    generated.properties |= PropertyId.WRITE;
  }],
  ["button-event", generated => {
    generated.adminOnlyAccess = [Access.NOTIFY];
  }],
  ["target-list", generated => {
    generated.adminOnlyAccess = [Access.READ, Access.WRITE];
  }],
  ["slat.state.current", generated => {
    generated.maxValue = 2
  }],
  ["event-snapshots-active", generated => {
    generated.format = "uint8";
    generated.minValue = 0;
    generated.maxValue = 1;
    generated.properties &= ~PropertyId.TIMED_WRITE;
  }],
  ["homekit-camera-active", generated => {
    generated.format = "uint8";
    generated.minValue = 0;
    generated.maxValue = 1;
    generated.properties &= ~PropertyId.TIMED_WRITE;
  }],
  ["periodic-snapshots-active", generated => {
    generated.format = "uint8";
    generated.properties &= ~PropertyId.TIMED_WRITE;
  }],
  ["third-party-camera-active", generated => {
    generated.format = "uint8";

  }],
  ["input-device-type", generated => {
    // @ts-ignore
    generated.validValues[6] = null;
  }],
  ["pairing-features", generated => {
    generated.properties &= ~PropertyId.WRITE;
  }],
  ["picture-mode", generated => {
    // @ts-ignore
    generated.validValues[8] = null;
    // @ts-ignore
    generated.validValues[9] = null;
    // @ts-ignore
    generated.validValues[10] = null;
    // @ts-ignore
    generated.validValues[11] = null;
    // @ts-ignore
    generated.validValues[12] = null;
    // @ts-ignore
    generated.validValues[13] = null;
  }],
  ["remote-key", generated => {
    // @ts-ignore
    generated.validValues[12] = null;
    // @ts-ignore
    generated.validValues[13] = null;
    // @ts-ignore
    generated.validValues[14] = null;
    // @ts-ignore
    generated.validValues[16] = null;
  }],
  ["service-label-namespace", generated => {
    generated.maxValue = 1;
  }],
  ["siri-input-type", generated => {
    generated.maxValue = 0;
  }],
  ["visibility-state.current", generated => {
    generated.maxValue = 1;
  }],
  ["active-identifier", generated => {
    generated.minValue = undefined;
  }],
  ["identifier", generated => {
    generated.minValue = undefined;
  }],

  ["access-code-control-point", generated => {
    generated.properties |= PropertyId.WRITE_RESPONSE;
  }],
  ["nfc-access-control-point", generated => {
    generated.properties |= PropertyId.WRITE_RESPONSE;
  }],
])

export const CharacteristicManualAdditions: Map<string, GeneratedCharacteristic> = new Map([
  ["diagonal-field-of-view", {
    id: "diagonal-field-of-view",
    UUID: "00000224-0000-1000-8000-0026BB765291",
    name: "Diagonal Field Of View",
    className: "DiagonalFieldOfView",
    since: "13.2",

    format: "float",
    units: "arcdegrees",
    properties: 3, // notify, paired read
    minValue: 0,
    maxValue: 360,
  }],
  ["version", { // don't know why, but version has notify permission even if it shouldn't have one
    id: "version",
    UUID: "00000037-0000-1000-8000-0026BB765291",
    name: "Version",
    className: "Version",

    format: "string",
    properties: 2, // paired read
    maxLength: 64,
  }],
  ["target-air-quality", { // some legacy characteristic, don't know where it comes from or where it was used
    id: "target-air-quality",
    UUID: "000000AE-0000-1000-8000-0026BB765291",
    name: "Target Air Quality",
    className: "TargetAirQuality",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint8",
    properties: 7, // read, write, notify
    minValue: 0,
    maxValue: 2,
    validValues: {
      "0": "EXCELLENT",
      "1": "GOOD",
      "2": "FAIR",
    } as Record<string, string>,
  }],
  ["target-slat-state", { // some legacy characteristic, don't know where it comes from or where it was used
    id: "target-slat-state",
    UUID: "000000BE-0000-1000-8000-0026BB765291",
    name: "Target Slat State",
    className: "TargetSlatState",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint8",
    properties: 7, // read, write, notify
    minValue: 0,
    maxValue: 1,
    validValues: {
      "0": "MANUAL",
      "1": "AUTO",
    } as Record<string, string>,
  }],

  ["current-time", {
    id: "current-time",
    UUID: "0000009B-0000-1000-8000-0026BB765291",
    name: "Current Time",
    className: "CurrentTime",
    deprecatedNotice: "Removed and not used anymore",

    format: "string",
    properties: 6, // read, write
  }],
  ["day-of-the-week", {
    id: "day-of-the-week",
    UUID: "00000098-0000-1000-8000-0026BB765291",
    name: "Day of the Week",
    className: "DayoftheWeek",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint8",
    properties: 6, // read, write
    minValue: 1,
    maxValue: 7,
  }],
  ["time-update", {
    id: "time-update",
    UUID: "0000009A-0000-1000-8000-0026BB765291",
    name: "Time Update",
    className: "TimeUpdate",
    deprecatedNotice: "Removed and not used anymore",

    format: "bool",
    properties: 6, // read, write
  }],

  ["reachable", {
    id: "reachable",
    UUID: "00000063-0000-1000-8000-0026BB765291",
    name: "Reachable",
    className: "Reachable",
    deprecatedNotice: "Removed and not used anymore",

    format: "bool",
    properties: 6, // read, write
  }],
  ["link-quality", {
    id: "link-quality",
    UUID: "0000009C-0000-1000-8000-0026BB765291",
    name: "Link Quality",
    className: "LinkQuality",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint8",
    properties: 3, // read, notify
    minValue: 1,
    maxValue: 4,
  }],
  ["category", {
    id: "category",
    UUID: "000000A3-0000-1000-8000-0026BB765291",
    name: "Category",
    className: "Category",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint16",
    properties: 3, // read, notify
    minValue: 1,
    maxValue: 16,
  }],

  ["configure-bridged-accessory-status", {
    id: "configure-bridged-accessory-status",
    UUID: "0000009D-0000-1000-8000-0026BB765291",
    name: "Configure Bridged Accessory Status",
    className: "ConfigureBridgedAccessoryStatus",
    deprecatedNotice: "Removed and not used anymore",

    format: "tlv8",
    properties: 3, // read, notify
  }],
  ["configure-bridged-accessory", {
    id: "configure-bridged-accessory",
    UUID: "000000A0-0000-1000-8000-0026BB765291",
    name: "Configure Bridged Accessory",
    className: "ConfigureBridgedAccessory",
    deprecatedNotice: "Removed and not used anymore",

    format: "tlv8",
    properties: 4,
  }],
  ["discover-bridged-accessories", {
    id: "discover-bridged-accessories",
    UUID: "0000009E-0000-1000-8000-0026BB765291",
    name: "Discover Bridged Accessories",
    className: "DiscoverBridgedAccessories",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint8",
    properties: 7, // read, write, notify
  }],
  ["discovered-bridged-accessories", {
    id: "discovered-bridged-accessories",
    UUID: "0000009F-0000-1000-8000-0026BB765291",
    name: "Discovered Bridged Accessories",
    className: "DiscoveredBridgedAccessories",
    deprecatedNotice: "Removed and not used anymore",

    format: "uint16",
    properties: 3, // read, notify
  }],
]);

export const ServiceNameOverrides: Map<string, string> = new Map([
  ["accessory-information", "Accessory Information"],
  ["camera-rtp-stream-management", "Camera RTP Stream Management"],
  ["fanv2", "Fanv2"],
  ["service-label", "Service Label"],
  ["smart-speaker", "Smart Speaker"],
  ["speaker", "Television Speaker"], // has some additional accessories
  ["nfc-access", "NFC Access"],
]);

export const ServiceDeprecatedNames: Map<string, string> = new Map([
  ["battery", "Battery Service"],
  ["camera-recording-management", "Camera Event Recording Management"],
  ["cloud-relay", "Relay"],
  ["slats", "Slat"],
  ["tunnel", "Tunneled BTLE Accessory Service"],
]);

interface CharacteristicConfigurationOverride {
  addedRequired?: string[],
  removedRequired?: string[],
  addedOptional?: string[],
  removedOptional?: string[],
}

export const ServiceCharacteristicConfigurationOverrides: Map<string, CharacteristicConfigurationOverride> = new Map([
  ["accessory-information", { addedRequired: ["firmware.revision"], removedOptional: ["firmware.revision"] }],
  ["camera-operating-mode", { addedOptional: ["diagonal-field-of-view"] }],
]);

export const ServiceManualAdditions: Map<string, GeneratedService> = new Map([
  ["og-speaker", { // the normal speaker is considered to be the "TelevisionSpeaker"
    id: "og-speaker",
    UUID: "00000113-0000-1000-8000-0026BB765291",
    name: "Speaker",
    className: "Speaker",
    since: "10",

    requiredCharacteristics: ["mute"],
    optionalCharacteristics: ["active", "volume"],
  }],
  ["camera-control", {
    id: "camera-control",
    UUID: "00000111-0000-1000-8000-0026BB765291",
    name: "Camera Control",
    className: "CameraControl",
    deprecatedNotice: "This service has no usage anymore and will be ignored by iOS",

    requiredCharacteristics: ["on"],
    optionalCharacteristics: ["horizontal-tilt.current", "vertical-tilt.current", "horizontal-tilt.target", "vertical-tilt.target", "night-vision", "optical-zoom", "digital-zoom", "image-rotation", "image-mirroring", "name"]
  }],
  ["time-information", {
    id: "time-information",
    UUID: "00000099-0000-1000-8000-0026BB765291",
    name: "Time Information",
    className: "TimeInformation",
    deprecatedNotice: "Removed and not used anymore",

    requiredCharacteristics: ["current-time", "day-of-the-week", "time-update"],
    optionalCharacteristics: ["name"],
  }],

  ["bridging-state", {
    id: "bridging-state",
    UUID: "00000062-0000-1000-8000-0026BB765291",
    name: "Bridging State",
    className: "BridgingState",
    deprecatedNotice: "Removed and not used anymore",

    requiredCharacteristics: ["reachable", "link-quality", "accessory.identifier", "category"],
    optionalCharacteristics: ["name"],
  }],

  ["bridge-configuration", {
    id: "bridge-configuration",
    UUID: "000000A1-0000-1000-8000-0026BB765291",
    name: "Bridge Configuration",
    className: "BridgeConfiguration",
    deprecatedNotice: "Removed and not used anymore",

    requiredCharacteristics: ["configure-bridged-accessory-status", "discover-bridged-accessories", "discovered-bridged-accessories", "configure-bridged-accessory"],
    optionalCharacteristics: ["name"],
  }],
]);

export const CharacteristicSinceInformation: Map<string, string> = new Map([
  ["activity-interval", "14"],
  ["cca-energy-detect-threshold", "14"],
  ["cca-signal-detect-threshold", "14"],
  ["characteristic-value-active-transition-count", "14"],
  ["characteristic-value-transition-control", "14"],
  ["current-transport", "14"],
  ["data-stream-hap-transport", "14"],
  ["data-stream-hap-transport-interrupt", "14"],
  ["event-retransmission-maximum", "14"],
  ["event-transmission-counters", "14"],
  ["heart-beat", "14"],
  ["mac-retransmission-maximum", "14"],
  ["mac-retransmission-counters", "14"],
  ["operating-state-response", "14"],
  ["ping", "14"],
  ["receiver-sensitivity", "14"],
  ["rssi", "14"],
  ["setup-transfer-transport", "13.4"],
  ["sleep-interval", "14"],
  ["snr", "14"],
  ["supported-characteristic-value-transition-configuration", "14"],
  ["supported-diagnostics-snapshot", "14"],
  ["supported-transfer-transport-configuration", "13.4"],
  ["transmit-power", "14"],
  ["transmit-power-maximum", "14"],
  ["transfer-transport-management", "13.4"],
  ["video-analysis-active", "14"],
  ["wake-configuration", "13.4"],
  ["wifi-capabilities", "14"],
  ["wifi-configuration-control", "14"],

  ["access-code-control-point", "15"],
  ["access-code-supported-configuration", "15"],
  ["configuration-state", "15"],
  ["hardware-finish", "15"],
  ["nfc-access-control-point", "15"],
  ["nfc-access-supported-configuration", "15"],
]);

export const ServiceSinceInformation: Map<string, string> = new Map([
  ["outlet", "13"],

  ["access-code", "15"],
  ["nfc-access", "15"],
]);
