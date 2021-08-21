// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY
// V=876

import { Access, Characteristic, Formats, Perms, Units } from "../Characteristic";

/**
 * Characteristic "Access Code Control Point"
 * @since iOS 15
 */
export class AccessCodeControlPoint extends Characteristic {

  public static readonly UUID: string = "00000262-0000-1000-8000-0026BB765291";

  constructor() {
    super("Access Code Control Point", AccessCodeControlPoint.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AccessCodeControlPoint = AccessCodeControlPoint;

/**
 * Characteristic "Access Code Supported Configuration"
 * @since iOS 15
 */
export class AccessCodeSupportedConfiguration extends Characteristic {

  public static readonly UUID: string = "00000261-0000-1000-8000-0026BB765291";

  constructor() {
    super("Access Code Supported Configuration", AccessCodeSupportedConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AccessCodeSupportedConfiguration = AccessCodeSupportedConfiguration;

/**
 * Characteristic "Access Control Level"
 */
export class AccessControlLevel extends Characteristic {

  public static readonly UUID: string = "000000E5-0000-1000-8000-0026BB765291";

  constructor() {
    super("Access Control Level", AccessControlLevel.UUID, {
      format: Formats.UINT16,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AccessControlLevel = AccessControlLevel;

/**
 * Characteristic "Accessory Flags"
 */
export class AccessoryFlags extends Characteristic {

  public static readonly UUID: string = "000000A6-0000-1000-8000-0026BB765291";

  public static readonly REQUIRES_ADDITIONAL_SETUP_BIT_MASK = 1;

  constructor() {
    super("Accessory Flags", AccessoryFlags.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AccessoryFlags = AccessoryFlags;

/**
 * Characteristic "Accessory Identifier"
 */
export class AccessoryIdentifier extends Characteristic {

  public static readonly UUID: string = "00000057-0000-1000-8000-0026BB765291";

  constructor() {
    super("Accessory Identifier", AccessoryIdentifier.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AccessoryIdentifier = AccessoryIdentifier;

/**
 * Characteristic "Active"
 */
export class Active extends Characteristic {

  public static readonly UUID: string = "000000B0-0000-1000-8000-0026BB765291";

  public static readonly INACTIVE = 0;
  public static readonly ACTIVE = 1;

  constructor() {
    super("Active", Active.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Active = Active;

/**
 * Characteristic "Active Identifier"
 */
export class ActiveIdentifier extends Characteristic {

  public static readonly UUID: string = "000000E7-0000-1000-8000-0026BB765291";

  constructor() {
    super("Active Identifier", ActiveIdentifier.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ActiveIdentifier = ActiveIdentifier;

/**
 * Characteristic "Activity Interval"
 * @since iOS 14
 */
export class ActivityInterval extends Characteristic {

  public static readonly UUID: string = "0000023B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Activity Interval", ActivityInterval.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ActivityInterval = ActivityInterval;

/**
 * Characteristic "Administrator Only Access"
 */
export class AdministratorOnlyAccess extends Characteristic {

  public static readonly UUID: string = "00000001-0000-1000-8000-0026BB765291";

  constructor() {
    super("Administrator Only Access", AdministratorOnlyAccess.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AdministratorOnlyAccess = AdministratorOnlyAccess;

/**
 * Characteristic "Air Particulate Density"
 */
export class AirParticulateDensity extends Characteristic {

  public static readonly UUID: string = "00000064-0000-1000-8000-0026BB765291";

  constructor() {
    super("Air Particulate Density", AirParticulateDensity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AirParticulateDensity = AirParticulateDensity;

/**
 * Characteristic "Air Particulate Size"
 */
export class AirParticulateSize extends Characteristic {

  public static readonly UUID: string = "00000065-0000-1000-8000-0026BB765291";

  public static readonly _2_5_M = 0;
  public static readonly _10_M = 1;

  constructor() {
    super("Air Particulate Size", AirParticulateSize.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AirParticulateSize = AirParticulateSize;

/**
 * Characteristic "Air Quality"
 */
export class AirQuality extends Characteristic {

  public static readonly UUID: string = "00000095-0000-1000-8000-0026BB765291";

  public static readonly UNKNOWN = 0;
  public static readonly EXCELLENT = 1;
  public static readonly GOOD = 2;
  public static readonly FAIR = 3;
  public static readonly INFERIOR = 4;
  public static readonly POOR = 5;

  constructor() {
    super("Air Quality", AirQuality.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 5,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AirQuality = AirQuality;

/**
 * Characteristic "App Matching Identifier"
 */
export class AppMatchingIdentifier extends Characteristic {

  public static readonly UUID: string = "000000A4-0000-1000-8000-0026BB765291";

  constructor() {
    super("App Matching Identifier", AppMatchingIdentifier.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AppMatchingIdentifier = AppMatchingIdentifier;

/**
 * Characteristic "Audio Feedback"
 */
export class AudioFeedback extends Characteristic {

  public static readonly UUID: string = "00000005-0000-1000-8000-0026BB765291";

  constructor() {
    super("Audio Feedback", AudioFeedback.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.AudioFeedback = AudioFeedback;

/**
 * Characteristic "Battery Level"
 */
export class BatteryLevel extends Characteristic {

  public static readonly UUID: string = "00000068-0000-1000-8000-0026BB765291";

  constructor() {
    super("Battery Level", BatteryLevel.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.BatteryLevel = BatteryLevel;

/**
 * Characteristic "Brightness"
 */
export class Brightness extends Characteristic {

  public static readonly UUID: string = "00000008-0000-1000-8000-0026BB765291";

  constructor() {
    super("Brightness", Brightness.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Brightness = Brightness;

/**
 * Characteristic "Button Event"
 */
export class ButtonEvent extends Characteristic {

  public static readonly UUID: string = "00000126-0000-1000-8000-0026BB765291";

  constructor() {
    super("Button Event", ButtonEvent.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      adminOnlyAccess: [Access.NOTIFY],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ButtonEvent = ButtonEvent;

/**
 * Characteristic "Camera Operating Mode Indicator"
 */
export class CameraOperatingModeIndicator extends Characteristic {

  public static readonly UUID: string = "0000021D-0000-1000-8000-0026BB765291";

  public static readonly DISABLE = 0;
  public static readonly ENABLE = 1;

  constructor() {
    super("Camera Operating Mode Indicator", CameraOperatingModeIndicator.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE],
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CameraOperatingModeIndicator = CameraOperatingModeIndicator;

/**
 * Characteristic "Carbon Dioxide Detected"
 */
export class CarbonDioxideDetected extends Characteristic {

  public static readonly UUID: string = "00000092-0000-1000-8000-0026BB765291";

  public static readonly CO2_LEVELS_NORMAL = 0;
  public static readonly CO2_LEVELS_ABNORMAL = 1;

  constructor() {
    super("Carbon Dioxide Detected", CarbonDioxideDetected.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonDioxideDetected = CarbonDioxideDetected;

/**
 * Characteristic "Carbon Dioxide Level"
 */
export class CarbonDioxideLevel extends Characteristic {

  public static readonly UUID: string = "00000093-0000-1000-8000-0026BB765291";

  constructor() {
    super("Carbon Dioxide Level", CarbonDioxideLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 100000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonDioxideLevel = CarbonDioxideLevel;

/**
 * Characteristic "Carbon Dioxide Peak Level"
 */
export class CarbonDioxidePeakLevel extends Characteristic {

  public static readonly UUID: string = "00000094-0000-1000-8000-0026BB765291";

  constructor() {
    super("Carbon Dioxide Peak Level", CarbonDioxidePeakLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 100000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonDioxidePeakLevel = CarbonDioxidePeakLevel;

/**
 * Characteristic "Carbon Monoxide Detected"
 */
export class CarbonMonoxideDetected extends Characteristic {

  public static readonly UUID: string = "00000069-0000-1000-8000-0026BB765291";

  public static readonly CO_LEVELS_NORMAL = 0;
  public static readonly CO_LEVELS_ABNORMAL = 1;

  constructor() {
    super("Carbon Monoxide Detected", CarbonMonoxideDetected.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonMonoxideDetected = CarbonMonoxideDetected;

/**
 * Characteristic "Carbon Monoxide Level"
 */
export class CarbonMonoxideLevel extends Characteristic {

  public static readonly UUID: string = "00000090-0000-1000-8000-0026BB765291";

  constructor() {
    super("Carbon Monoxide Level", CarbonMonoxideLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonMonoxideLevel = CarbonMonoxideLevel;

/**
 * Characteristic "Carbon Monoxide Peak Level"
 */
export class CarbonMonoxidePeakLevel extends Characteristic {

  public static readonly UUID: string = "00000091-0000-1000-8000-0026BB765291";

  constructor() {
    super("Carbon Monoxide Peak Level", CarbonMonoxidePeakLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CarbonMonoxidePeakLevel = CarbonMonoxidePeakLevel;

/**
 * Characteristic "Category"
 * @deprecated Removed and not used anymore
 */
export class Category extends Characteristic {

  public static readonly UUID: string = "000000A3-0000-1000-8000-0026BB765291";

  constructor() {
    super("Category", Category.UUID, {
      format: Formats.UINT16,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 1,
      maxValue: 16,
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.Category = Category;

/**
 * Characteristic "CCA Energy Detect Threshold"
 * @since iOS 14
 */
export class CCAEnergyDetectThreshold extends Characteristic {

  public static readonly UUID: string = "00000246-0000-1000-8000-0026BB765291";

  constructor() {
    super("CCA Energy Detect Threshold", CCAEnergyDetectThreshold.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CCAEnergyDetectThreshold = CCAEnergyDetectThreshold;

/**
 * Characteristic "CCA Signal Detect Threshold"
 * @since iOS 14
 */
export class CCASignalDetectThreshold extends Characteristic {

  public static readonly UUID: string = "00000245-0000-1000-8000-0026BB765291";

  constructor() {
    super("CCA Signal Detect Threshold", CCASignalDetectThreshold.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CCASignalDetectThreshold = CCASignalDetectThreshold;

/**
 * Characteristic "Characteristic Value Active Transition Count"
 * @since iOS 14
 */
export class CharacteristicValueActiveTransitionCount extends Characteristic {

  public static readonly UUID: string = "0000024B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Characteristic Value Active Transition Count", CharacteristicValueActiveTransitionCount.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CharacteristicValueActiveTransitionCount = CharacteristicValueActiveTransitionCount;

/**
 * Characteristic "Characteristic Value Transition Control"
 * @since iOS 14
 */
export class CharacteristicValueTransitionControl extends Characteristic {

  public static readonly UUID: string = "00000143-0000-1000-8000-0026BB765291";

  constructor() {
    super("Characteristic Value Transition Control", CharacteristicValueTransitionControl.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CharacteristicValueTransitionControl = CharacteristicValueTransitionControl;

/**
 * Characteristic "Charging State"
 */
export class ChargingState extends Characteristic {

  public static readonly UUID: string = "0000008F-0000-1000-8000-0026BB765291";

  public static readonly NOT_CHARGING = 0;
  public static readonly CHARGING = 1;
  public static readonly NOT_CHARGEABLE = 2;

  constructor() {
    super("Charging State", ChargingState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ChargingState = ChargingState;

/**
 * Characteristic "Closed Captions"
 */
export class ClosedCaptions extends Characteristic {

  public static readonly UUID: string = "000000DD-0000-1000-8000-0026BB765291";

  public static readonly DISABLED = 0;
  public static readonly ENABLED = 1;

  constructor() {
    super("Closed Captions", ClosedCaptions.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ClosedCaptions = ClosedCaptions;

/**
 * Characteristic "Color Temperature"
 */
export class ColorTemperature extends Characteristic {

  public static readonly UUID: string = "000000CE-0000-1000-8000-0026BB765291";

  constructor() {
    super("Color Temperature", ColorTemperature.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 140,
      maxValue: 500,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ColorTemperature = ColorTemperature;

/**
 * Characteristic "Configuration State"
 * @since iOS 15
 */
export class ConfigurationState extends Characteristic {

  public static readonly UUID: string = "00000263-0000-1000-8000-0026BB765291";

  constructor() {
    super("Configuration State", ConfigurationState.UUID, {
      format: Formats.UINT16,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ConfigurationState = ConfigurationState;

/**
 * Characteristic "Configure Bridged Accessory"
 * @deprecated Removed and not used anymore
 */
export class ConfigureBridgedAccessory extends Characteristic {

  public static readonly UUID: string = "000000A0-0000-1000-8000-0026BB765291";

  constructor() {
    super("Configure Bridged Accessory", ConfigureBridgedAccessory.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.ConfigureBridgedAccessory = ConfigureBridgedAccessory;

/**
 * Characteristic "Configure Bridged Accessory Status"
 * @deprecated Removed and not used anymore
 */
export class ConfigureBridgedAccessoryStatus extends Characteristic {

  public static readonly UUID: string = "0000009D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Configure Bridged Accessory Status", ConfigureBridgedAccessoryStatus.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.ConfigureBridgedAccessoryStatus = ConfigureBridgedAccessoryStatus;

/**
 * Characteristic "Configured Name"
 */
export class ConfiguredName extends Characteristic {

  public static readonly UUID: string = "000000E3-0000-1000-8000-0026BB765291";

  constructor() {
    super("Configured Name", ConfiguredName.UUID, {
      format: Formats.STRING,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ConfiguredName = ConfiguredName;

/**
 * Characteristic "Contact Sensor State"
 */
export class ContactSensorState extends Characteristic {

  public static readonly UUID: string = "0000006A-0000-1000-8000-0026BB765291";

  public static readonly CONTACT_DETECTED = 0;
  public static readonly CONTACT_NOT_DETECTED = 1;

  constructor() {
    super("Contact Sensor State", ContactSensorState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ContactSensorState = ContactSensorState;

/**
 * Characteristic "Cooling Threshold Temperature"
 */
export class CoolingThresholdTemperature extends Characteristic {

  public static readonly UUID: string = "0000000D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Cooling Threshold Temperature", CoolingThresholdTemperature.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.CELSIUS,
      minValue: 10,
      maxValue: 35,
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CoolingThresholdTemperature = CoolingThresholdTemperature;

/**
 * Characteristic "Current Air Purifier State"
 */
export class CurrentAirPurifierState extends Characteristic {

  public static readonly UUID: string = "000000A9-0000-1000-8000-0026BB765291";

  public static readonly INACTIVE = 0;
  public static readonly IDLE = 1;
  public static readonly PURIFYING_AIR = 2;

  constructor() {
    super("Current Air Purifier State", CurrentAirPurifierState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentAirPurifierState = CurrentAirPurifierState;

/**
 * Characteristic "Current Ambient Light Level"
 */
export class CurrentAmbientLightLevel extends Characteristic {

  public static readonly UUID: string = "0000006B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Ambient Light Level", CurrentAmbientLightLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.LUX,
      minValue: 0.0001,
      maxValue: 100000,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentAmbientLightLevel = CurrentAmbientLightLevel;

/**
 * Characteristic "Current Door State"
 */
export class CurrentDoorState extends Characteristic {

  public static readonly UUID: string = "0000000E-0000-1000-8000-0026BB765291";

  public static readonly OPEN = 0;
  public static readonly CLOSED = 1;
  public static readonly OPENING = 2;
  public static readonly CLOSING = 3;
  public static readonly STOPPED = 4;

  constructor() {
    super("Current Door State", CurrentDoorState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 4,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentDoorState = CurrentDoorState;

/**
 * Characteristic "Current Fan State"
 */
export class CurrentFanState extends Characteristic {

  public static readonly UUID: string = "000000AF-0000-1000-8000-0026BB765291";

  public static readonly INACTIVE = 0;
  public static readonly IDLE = 1;
  public static readonly BLOWING_AIR = 2;

  constructor() {
    super("Current Fan State", CurrentFanState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentFanState = CurrentFanState;

/**
 * Characteristic "Current Heater-Cooler State"
 */
export class CurrentHeaterCoolerState extends Characteristic {

  public static readonly UUID: string = "000000B1-0000-1000-8000-0026BB765291";

  public static readonly INACTIVE = 0;
  public static readonly IDLE = 1;
  public static readonly HEATING = 2;
  public static readonly COOLING = 3;

  constructor() {
    super("Current Heater-Cooler State", CurrentHeaterCoolerState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentHeaterCoolerState = CurrentHeaterCoolerState;

/**
 * Characteristic "Current Heating Cooling State"
 */
export class CurrentHeatingCoolingState extends Characteristic {

  public static readonly UUID: string = "0000000F-0000-1000-8000-0026BB765291";

  public static readonly OFF = 0;
  public static readonly HEAT = 1;
  public static readonly COOL = 2;

  constructor() {
    super("Current Heating Cooling State", CurrentHeatingCoolingState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentHeatingCoolingState = CurrentHeatingCoolingState;

/**
 * Characteristic "Current Horizontal Tilt Angle"
 */
export class CurrentHorizontalTiltAngle extends Characteristic {

  public static readonly UUID: string = "0000006C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Horizontal Tilt Angle", CurrentHorizontalTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentHorizontalTiltAngle = CurrentHorizontalTiltAngle;

/**
 * Characteristic "Current Humidifier-Dehumidifier State"
 */
export class CurrentHumidifierDehumidifierState extends Characteristic {

  public static readonly UUID: string = "000000B3-0000-1000-8000-0026BB765291";

  public static readonly INACTIVE = 0;
  public static readonly IDLE = 1;
  public static readonly HUMIDIFYING = 2;
  public static readonly DEHUMIDIFYING = 3;

  constructor() {
    super("Current Humidifier-Dehumidifier State", CurrentHumidifierDehumidifierState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentHumidifierDehumidifierState = CurrentHumidifierDehumidifierState;

/**
 * Characteristic "Current Media State"
 */
export class CurrentMediaState extends Characteristic {

  public static readonly UUID: string = "000000E0-0000-1000-8000-0026BB765291";

  public static readonly PLAY = 0;
  public static readonly PAUSE = 1;
  public static readonly STOP = 2;
  public static readonly LOADING = 4;
  public static readonly INTERRUPTED = 5;

  constructor() {
    super("Current Media State", CurrentMediaState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 5,
      minStep: 1,
      validValues: [0, 1, 2, 4, 5],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentMediaState = CurrentMediaState;

/**
 * Characteristic "Current Position"
 */
export class CurrentPosition extends Characteristic {

  public static readonly UUID: string = "0000006D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Position", CurrentPosition.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentPosition = CurrentPosition;

/**
 * Characteristic "Current Relative Humidity"
 */
export class CurrentRelativeHumidity extends Characteristic {

  public static readonly UUID: string = "00000010-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Relative Humidity", CurrentRelativeHumidity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentRelativeHumidity = CurrentRelativeHumidity;

/**
 * Characteristic "Current Slat State"
 */
export class CurrentSlatState extends Characteristic {

  public static readonly UUID: string = "000000AA-0000-1000-8000-0026BB765291";

  public static readonly FIXED = 0;
  public static readonly JAMMED = 1;
  public static readonly SWINGING = 2;

  constructor() {
    super("Current Slat State", CurrentSlatState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentSlatState = CurrentSlatState;

/**
 * Characteristic "Current Temperature"
 */
export class CurrentTemperature extends Characteristic {

  public static readonly UUID: string = "00000011-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Temperature", CurrentTemperature.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.CELSIUS,
      minValue: -270,
      maxValue: 100,
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentTemperature = CurrentTemperature;

/**
 * Characteristic "Current Tilt Angle"
 */
export class CurrentTiltAngle extends Characteristic {

  public static readonly UUID: string = "000000C1-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Tilt Angle", CurrentTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentTiltAngle = CurrentTiltAngle;

/**
 * Characteristic "Current Time"
 * @deprecated Removed and not used anymore
 */
export class CurrentTime extends Characteristic {

  public static readonly UUID: string = "0000009B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Time", CurrentTime.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.CurrentTime = CurrentTime;

/**
 * Characteristic "Current Transport"
 * @since iOS 14
 */
export class CurrentTransport extends Characteristic {

  public static readonly UUID: string = "0000022B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Transport", CurrentTransport.UUID, {
      format: Formats.BOOL,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentTransport = CurrentTransport;

/**
 * Characteristic "Current Vertical Tilt Angle"
 */
export class CurrentVerticalTiltAngle extends Characteristic {

  public static readonly UUID: string = "0000006E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Current Vertical Tilt Angle", CurrentVerticalTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentVerticalTiltAngle = CurrentVerticalTiltAngle;

/**
 * Characteristic "Current Visibility State"
 */
export class CurrentVisibilityState extends Characteristic {

  public static readonly UUID: string = "00000135-0000-1000-8000-0026BB765291";

  public static readonly SHOWN = 0;
  public static readonly HIDDEN = 1;

  constructor() {
    super("Current Visibility State", CurrentVisibilityState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.CurrentVisibilityState = CurrentVisibilityState;

/**
 * Characteristic "Data Stream HAP Transport"
 * @since iOS 14
 */
export class DataStreamHAPTransport extends Characteristic {

  public static readonly UUID: string = "00000138-0000-1000-8000-0026BB765291";

  constructor() {
    super("Data Stream HAP Transport", DataStreamHAPTransport.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.DataStreamHAPTransport = DataStreamHAPTransport;

/**
 * Characteristic "Data Stream HAP Transport Interrupt"
 * @since iOS 14
 */
export class DataStreamHAPTransportInterrupt extends Characteristic {

  public static readonly UUID: string = "00000139-0000-1000-8000-0026BB765291";

  constructor() {
    super("Data Stream HAP Transport Interrupt", DataStreamHAPTransportInterrupt.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.DataStreamHAPTransportInterrupt = DataStreamHAPTransportInterrupt;

/**
 * Characteristic "Day of the Week"
 * @deprecated Removed and not used anymore
 */
export class DayoftheWeek extends Characteristic {

  public static readonly UUID: string = "00000098-0000-1000-8000-0026BB765291";

  constructor() {
    super("Day of the Week", DayoftheWeek.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 1,
      maxValue: 7,
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.DayoftheWeek = DayoftheWeek;

/**
 * Characteristic "Diagonal Field Of View"
 * @since iOS 13.2
 */
export class DiagonalFieldOfView extends Characteristic {

  public static readonly UUID: string = "00000224-0000-1000-8000-0026BB765291";

  constructor() {
    super("Diagonal Field Of View", DiagonalFieldOfView.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.ARC_DEGREE,
      minValue: 0,
      maxValue: 360,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.DiagonalFieldOfView = DiagonalFieldOfView;

/**
 * Characteristic "Digital Zoom"
 */
export class DigitalZoom extends Characteristic {

  public static readonly UUID: string = "0000011D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Digital Zoom", DigitalZoom.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.DigitalZoom = DigitalZoom;

/**
 * Characteristic "Discover Bridged Accessories"
 * @deprecated Removed and not used anymore
 */
export class DiscoverBridgedAccessories extends Characteristic {

  public static readonly UUID: string = "0000009E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Discover Bridged Accessories", DiscoverBridgedAccessories.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.DiscoverBridgedAccessories = DiscoverBridgedAccessories;

/**
 * Characteristic "Discovered Bridged Accessories"
 * @deprecated Removed and not used anymore
 */
export class DiscoveredBridgedAccessories extends Characteristic {

  public static readonly UUID: string = "0000009F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Discovered Bridged Accessories", DiscoveredBridgedAccessories.UUID, {
      format: Formats.UINT16,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.DiscoveredBridgedAccessories = DiscoveredBridgedAccessories;

/**
 * Characteristic "Display Order"
 */
export class DisplayOrder extends Characteristic {

  public static readonly UUID: string = "00000136-0000-1000-8000-0026BB765291";

  constructor() {
    super("Display Order", DisplayOrder.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.DisplayOrder = DisplayOrder;

/**
 * Characteristic "Event Retransmission Maximum"
 * @since iOS 14
 */
export class EventRetransmissionMaximum extends Characteristic {

  public static readonly UUID: string = "0000023D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Event Retransmission Maximum", EventRetransmissionMaximum.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.EventRetransmissionMaximum = EventRetransmissionMaximum;

/**
 * Characteristic "Event Snapshots Active"
 */
export class EventSnapshotsActive extends Characteristic {

  public static readonly UUID: string = "00000223-0000-1000-8000-0026BB765291";

  public static readonly DISABLE = 0;
  public static readonly ENABLE = 1;

  constructor() {
    super("Event Snapshots Active", EventSnapshotsActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.EventSnapshotsActive = EventSnapshotsActive;

/**
 * Characteristic "Event Transmission Counters"
 * @since iOS 14
 */
export class EventTransmissionCounters extends Characteristic {

  public static readonly UUID: string = "0000023E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Event Transmission Counters", EventTransmissionCounters.UUID, {
      format: Formats.UINT32,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.EventTransmissionCounters = EventTransmissionCounters;

/**
 * Characteristic "Filter Change Indication"
 */
export class FilterChangeIndication extends Characteristic {

  public static readonly UUID: string = "000000AC-0000-1000-8000-0026BB765291";

  public static readonly FILTER_OK = 0;
  public static readonly CHANGE_FILTER = 1;

  constructor() {
    super("Filter Change Indication", FilterChangeIndication.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.FilterChangeIndication = FilterChangeIndication;

/**
 * Characteristic "Filter Life Level"
 */
export class FilterLifeLevel extends Characteristic {

  public static readonly UUID: string = "000000AB-0000-1000-8000-0026BB765291";

  constructor() {
    super("Filter Life Level", FilterLifeLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.FilterLifeLevel = FilterLifeLevel;

/**
 * Characteristic "Firmware Revision"
 */
export class FirmwareRevision extends Characteristic {

  public static readonly UUID: string = "00000052-0000-1000-8000-0026BB765291";

  constructor() {
    super("Firmware Revision", FirmwareRevision.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.FirmwareRevision = FirmwareRevision;

/**
 * Characteristic "Firmware Update Readiness"
 */
export class FirmwareUpdateReadiness extends Characteristic {

  public static readonly UUID: string = "00000234-0000-1000-8000-0026BB765291";

  constructor() {
    super("Firmware Update Readiness", FirmwareUpdateReadiness.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.FirmwareUpdateReadiness = FirmwareUpdateReadiness;

/**
 * Characteristic "Firmware Update Status"
 */
export class FirmwareUpdateStatus extends Characteristic {

  public static readonly UUID: string = "00000235-0000-1000-8000-0026BB765291";

  constructor() {
    super("Firmware Update Status", FirmwareUpdateStatus.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.FirmwareUpdateStatus = FirmwareUpdateStatus;

/**
 * Characteristic "Hardware Finish"
 * @since iOS 15
 */
export class HardwareFinish extends Characteristic {

  public static readonly UUID: string = "0000026C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Hardware Finish", HardwareFinish.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HardwareFinish = HardwareFinish;

/**
 * Characteristic "Hardware Revision"
 */
export class HardwareRevision extends Characteristic {

  public static readonly UUID: string = "00000053-0000-1000-8000-0026BB765291";

  constructor() {
    super("Hardware Revision", HardwareRevision.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HardwareRevision = HardwareRevision;

/**
 * Characteristic "Heart Beat"
 * @since iOS 14
 */
export class HeartBeat extends Characteristic {

  public static readonly UUID: string = "0000024A-0000-1000-8000-0026BB765291";

  constructor() {
    super("Heart Beat", HeartBeat.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HeartBeat = HeartBeat;

/**
 * Characteristic "Heating Threshold Temperature"
 */
export class HeatingThresholdTemperature extends Characteristic {

  public static readonly UUID: string = "00000012-0000-1000-8000-0026BB765291";

  constructor() {
    super("Heating Threshold Temperature", HeatingThresholdTemperature.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.CELSIUS,
      minValue: 0,
      maxValue: 25,
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HeatingThresholdTemperature = HeatingThresholdTemperature;

/**
 * Characteristic "Hold Position"
 */
export class HoldPosition extends Characteristic {

  public static readonly UUID: string = "0000006F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Hold Position", HoldPosition.UUID, {
      format: Formats.BOOL,
      perms: [Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HoldPosition = HoldPosition;

/**
 * Characteristic "HomeKit Camera Active"
 */
export class HomeKitCameraActive extends Characteristic {

  public static readonly UUID: string = "0000021B-0000-1000-8000-0026BB765291";

  public static readonly OFF = 0;
  public static readonly ON = 1;

  constructor() {
    super("HomeKit Camera Active", HomeKitCameraActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.HomeKitCameraActive = HomeKitCameraActive;

/**
 * Characteristic "Hue"
 */
export class Hue extends Characteristic {

  public static readonly UUID: string = "00000013-0000-1000-8000-0026BB765291";

  constructor() {
    super("Hue", Hue.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.ARC_DEGREE,
      minValue: 0,
      maxValue: 360,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Hue = Hue;

/**
 * Characteristic "Identifier"
 */
export class Identifier extends Characteristic {

  public static readonly UUID: string = "000000E6-0000-1000-8000-0026BB765291";

  constructor() {
    super("Identifier", Identifier.UUID, {
      format: Formats.UINT32,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Identifier = Identifier;

/**
 * Characteristic "Identify"
 */
export class Identify extends Characteristic {

  public static readonly UUID: string = "00000014-0000-1000-8000-0026BB765291";

  constructor() {
    super("Identify", Identify.UUID, {
      format: Formats.BOOL,
      perms: [Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Identify = Identify;

/**
 * Characteristic "Image Mirroring"
 */
export class ImageMirroring extends Characteristic {

  public static readonly UUID: string = "0000011F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Image Mirroring", ImageMirroring.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ImageMirroring = ImageMirroring;

/**
 * Characteristic "Image Rotation"
 */
export class ImageRotation extends Characteristic {

  public static readonly UUID: string = "0000011E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Image Rotation", ImageRotation.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.ARC_DEGREE,
      minValue: 0,
      maxValue: 360,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ImageRotation = ImageRotation;

/**
 * Characteristic "Input Device Type"
 */
export class InputDeviceType extends Characteristic {

  public static readonly UUID: string = "000000DC-0000-1000-8000-0026BB765291";

  public static readonly OTHER = 0;
  public static readonly TV = 1;
  public static readonly RECORDING = 2;
  public static readonly TUNER = 3;
  public static readonly PLAYBACK = 4;
  public static readonly AUDIO_SYSTEM = 5;

  constructor() {
    super("Input Device Type", InputDeviceType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 6,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5, 6],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.InputDeviceType = InputDeviceType;

/**
 * Characteristic "Input Source Type"
 */
export class InputSourceType extends Characteristic {

  public static readonly UUID: string = "000000DB-0000-1000-8000-0026BB765291";

  public static readonly OTHER = 0;
  public static readonly HOME_SCREEN = 1;
  public static readonly TUNER = 2;
  public static readonly HDMI = 3;
  public static readonly COMPOSITE_VIDEO = 4;
  public static readonly S_VIDEO = 5;
  public static readonly COMPONENT_VIDEO = 6;
  public static readonly DVI = 7;
  public static readonly AIRPLAY = 8;
  public static readonly USB = 9;
  public static readonly APPLICATION = 10;

  constructor() {
    super("Input Source Type", InputSourceType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 10,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.InputSourceType = InputSourceType;

/**
 * Characteristic "In Use"
 */
export class InUse extends Characteristic {

  public static readonly UUID: string = "000000D2-0000-1000-8000-0026BB765291";

  public static readonly NOT_IN_USE = 0;
  public static readonly IN_USE = 1;

  constructor() {
    super("In Use", InUse.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.InUse = InUse;

/**
 * Characteristic "Is Configured"
 */
export class IsConfigured extends Characteristic {

  public static readonly UUID: string = "000000D6-0000-1000-8000-0026BB765291";

  public static readonly NOT_CONFIGURED = 0;
  public static readonly CONFIGURED = 1;

  constructor() {
    super("Is Configured", IsConfigured.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.IsConfigured = IsConfigured;

/**
 * Characteristic "Leak Detected"
 */
export class LeakDetected extends Characteristic {

  public static readonly UUID: string = "00000070-0000-1000-8000-0026BB765291";

  public static readonly LEAK_NOT_DETECTED = 0;
  public static readonly LEAK_DETECTED = 1;

  constructor() {
    super("Leak Detected", LeakDetected.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LeakDetected = LeakDetected;

/**
 * Characteristic "Link Quality"
 * @deprecated Removed and not used anymore
 */
export class LinkQuality extends Characteristic {

  public static readonly UUID: string = "0000009C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Link Quality", LinkQuality.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 1,
      maxValue: 4,
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.LinkQuality = LinkQuality;

/**
 * Characteristic "List Pairings"
 */
export class ListPairings extends Characteristic {

  public static readonly UUID: string = "00000050-0000-1000-8000-0026BB765291";

  constructor() {
    super("List Pairings", ListPairings.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ListPairings = ListPairings;

/**
 * Characteristic "Lock Control Point"
 */
export class LockControlPoint extends Characteristic {

  public static readonly UUID: string = "00000019-0000-1000-8000-0026BB765291";

  constructor() {
    super("Lock Control Point", LockControlPoint.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockControlPoint = LockControlPoint;

/**
 * Characteristic "Lock Current State"
 */
export class LockCurrentState extends Characteristic {

  public static readonly UUID: string = "0000001D-0000-1000-8000-0026BB765291";

  public static readonly UNSECURED = 0;
  public static readonly SECURED = 1;
  public static readonly JAMMED = 2;
  public static readonly UNKNOWN = 3;

  constructor() {
    super("Lock Current State", LockCurrentState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockCurrentState = LockCurrentState;

/**
 * Characteristic "Lock Last Known Action"
 */
export class LockLastKnownAction extends Characteristic {

  public static readonly UUID: string = "0000001C-0000-1000-8000-0026BB765291";

  public static readonly SECURED_PHYSICALLY_INTERIOR = 0;
  public static readonly UNSECURED_PHYSICALLY_INTERIOR = 1;
  public static readonly SECURED_PHYSICALLY_EXTERIOR = 2;
  public static readonly UNSECURED_PHYSICALLY_EXTERIOR = 3;
  public static readonly SECURED_BY_KEYPAD = 4;
  public static readonly UNSECURED_BY_KEYPAD = 5;
  public static readonly SECURED_REMOTELY = 6;
  public static readonly UNSECURED_REMOTELY = 7;
  public static readonly SECURED_BY_AUTO_SECURE_TIMEOUT = 8;
  public static readonly SECURED_PHYSICALLY = 9;
  public static readonly UNSECURED_PHYSICALLY = 10;

  constructor() {
    super("Lock Last Known Action", LockLastKnownAction.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 10,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockLastKnownAction = LockLastKnownAction;

/**
 * Characteristic "Lock Management Auto Security Timeout"
 */
export class LockManagementAutoSecurityTimeout extends Characteristic {

  public static readonly UUID: string = "0000001A-0000-1000-8000-0026BB765291";

  constructor() {
    super("Lock Management Auto Security Timeout", LockManagementAutoSecurityTimeout.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.SECONDS,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockManagementAutoSecurityTimeout = LockManagementAutoSecurityTimeout;

/**
 * Characteristic "Lock Physical Controls"
 */
export class LockPhysicalControls extends Characteristic {

  public static readonly UUID: string = "000000A7-0000-1000-8000-0026BB765291";

  public static readonly CONTROL_LOCK_DISABLED = 0;
  public static readonly CONTROL_LOCK_ENABLED = 1;

  constructor() {
    super("Lock Physical Controls", LockPhysicalControls.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockPhysicalControls = LockPhysicalControls;

/**
 * Characteristic "Lock Target State"
 */
export class LockTargetState extends Characteristic {

  public static readonly UUID: string = "0000001E-0000-1000-8000-0026BB765291";

  public static readonly UNSECURED = 0;
  public static readonly SECURED = 1;

  constructor() {
    super("Lock Target State", LockTargetState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.LockTargetState = LockTargetState;

/**
 * Characteristic "Logs"
 */
export class Logs extends Characteristic {

  public static readonly UUID: string = "0000001F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Logs", Logs.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Logs = Logs;

/**
 * Characteristic "MAC Retransmission Maximum"
 * @since iOS 14
 */
export class MACRetransmissionMaximum extends Characteristic {

  public static readonly UUID: string = "00000247-0000-1000-8000-0026BB765291";

  constructor() {
    super("MAC Retransmission Maximum", MACRetransmissionMaximum.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.MACRetransmissionMaximum = MACRetransmissionMaximum;

/**
 * Characteristic "MAC Transmission Counters"
 */
export class MACTransmissionCounters extends Characteristic {

  public static readonly UUID: string = "00000248-0000-1000-8000-0026BB765291";

  constructor() {
    super("MAC Transmission Counters", MACTransmissionCounters.UUID, {
      format: Formats.DATA,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.MACTransmissionCounters = MACTransmissionCounters;

/**
 * Characteristic "Managed Network Enable"
 */
export class ManagedNetworkEnable extends Characteristic {

  public static readonly UUID: string = "00000215-0000-1000-8000-0026BB765291";

  public static readonly DISABLED = 0;
  public static readonly ENABLED = 1;

  constructor() {
    super("Managed Network Enable", ManagedNetworkEnable.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE],
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ManagedNetworkEnable = ManagedNetworkEnable;

/**
 * Characteristic "Manually Disabled"
 */
export class ManuallyDisabled extends Characteristic {

  public static readonly UUID: string = "00000227-0000-1000-8000-0026BB765291";

  public static readonly ENABLED = 0;
  public static readonly DISABLED = 1;

  constructor() {
    super("Manually Disabled", ManuallyDisabled.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ManuallyDisabled = ManuallyDisabled;

/**
 * Characteristic "Manufacturer"
 */
export class Manufacturer extends Characteristic {

  public static readonly UUID: string = "00000020-0000-1000-8000-0026BB765291";

  constructor() {
    super("Manufacturer", Manufacturer.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
      maxLen: 64,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Manufacturer = Manufacturer;

/**
 * Characteristic "Maximum Transmit Power"
 * @since iOS 14
 */
export class MaximumTransmitPower extends Characteristic {

  public static readonly UUID: string = "00000243-0000-1000-8000-0026BB765291";

  constructor() {
    super("Maximum Transmit Power", MaximumTransmitPower.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.MaximumTransmitPower = MaximumTransmitPower;

/**
 * Characteristic "Model"
 */
export class Model extends Characteristic {

  public static readonly UUID: string = "00000021-0000-1000-8000-0026BB765291";

  constructor() {
    super("Model", Model.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
      maxLen: 64,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Model = Model;

/**
 * Characteristic "Motion Detected"
 */
export class MotionDetected extends Characteristic {

  public static readonly UUID: string = "00000022-0000-1000-8000-0026BB765291";

  constructor() {
    super("Motion Detected", MotionDetected.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.MotionDetected = MotionDetected;

/**
 * Characteristic "Mute"
 */
export class Mute extends Characteristic {

  public static readonly UUID: string = "0000011A-0000-1000-8000-0026BB765291";

  constructor() {
    super("Mute", Mute.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Mute = Mute;

/**
 * Characteristic "Name"
 */
export class Name extends Characteristic {

  public static readonly UUID: string = "00000023-0000-1000-8000-0026BB765291";

  constructor() {
    super("Name", Name.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
      maxLen: 64,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Name = Name;

/**
 * Characteristic "Network Access Violation Control"
 */
export class NetworkAccessViolationControl extends Characteristic {

  public static readonly UUID: string = "0000021F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Network Access Violation Control", NetworkAccessViolationControl.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NetworkAccessViolationControl = NetworkAccessViolationControl;

/**
 * Characteristic "Network Client Profile Control"
 */
export class NetworkClientProfileControl extends Characteristic {

  public static readonly UUID: string = "0000020C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Network Client Profile Control", NetworkClientProfileControl.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NetworkClientProfileControl = NetworkClientProfileControl;

/**
 * Characteristic "Network Client Status Control"
 */
export class NetworkClientStatusControl extends Characteristic {

  public static readonly UUID: string = "0000020D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Network Client Status Control", NetworkClientStatusControl.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NetworkClientStatusControl = NetworkClientStatusControl;

/**
 * Characteristic "NFC Access Control Point"
 * @since iOS 15
 */
export class NFCAccessControlPoint extends Characteristic {

  public static readonly UUID: string = "00000264-0000-1000-8000-0026BB765291";

  constructor() {
    super("NFC Access Control Point", NFCAccessControlPoint.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NFCAccessControlPoint = NFCAccessControlPoint;

/**
 * Characteristic "NFC Access Supported Configuration"
 * @since iOS 15
 */
export class NFCAccessSupportedConfiguration extends Characteristic {

  public static readonly UUID: string = "00000265-0000-1000-8000-0026BB765291";

  constructor() {
    super("NFC Access Supported Configuration", NFCAccessSupportedConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NFCAccessSupportedConfiguration = NFCAccessSupportedConfiguration;

/**
 * Characteristic "Night Vision"
 */
export class NightVision extends Characteristic {

  public static readonly UUID: string = "0000011B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Night Vision", NightVision.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NightVision = NightVision;

/**
 * Characteristic "Nitrogen Dioxide Density"
 */
export class NitrogenDioxideDensity extends Characteristic {

  public static readonly UUID: string = "000000C4-0000-1000-8000-0026BB765291";

  constructor() {
    super("Nitrogen Dioxide Density", NitrogenDioxideDensity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.NitrogenDioxideDensity = NitrogenDioxideDensity;

/**
 * Characteristic "Obstruction Detected"
 */
export class ObstructionDetected extends Characteristic {

  public static readonly UUID: string = "00000024-0000-1000-8000-0026BB765291";

  constructor() {
    super("Obstruction Detected", ObstructionDetected.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ObstructionDetected = ObstructionDetected;

/**
 * Characteristic "Occupancy Detected"
 */
export class OccupancyDetected extends Characteristic {

  public static readonly UUID: string = "00000071-0000-1000-8000-0026BB765291";

  public static readonly OCCUPANCY_NOT_DETECTED = 0;
  public static readonly OCCUPANCY_DETECTED = 1;

  constructor() {
    super("Occupancy Detected", OccupancyDetected.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.OccupancyDetected = OccupancyDetected;

/**
 * Characteristic "On"
 */
export class On extends Characteristic {

  public static readonly UUID: string = "00000025-0000-1000-8000-0026BB765291";

  constructor() {
    super("On", On.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.On = On;

/**
 * Characteristic "Operating State Response"
 * @since iOS 14
 */
export class OperatingStateResponse extends Characteristic {

  public static readonly UUID: string = "00000232-0000-1000-8000-0026BB765291";

  constructor() {
    super("Operating State Response", OperatingStateResponse.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.OperatingStateResponse = OperatingStateResponse;

/**
 * Characteristic "Optical Zoom"
 */
export class OpticalZoom extends Characteristic {

  public static readonly UUID: string = "0000011C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Optical Zoom", OpticalZoom.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.OpticalZoom = OpticalZoom;

/**
 * Characteristic "Outlet In Use"
 */
export class OutletInUse extends Characteristic {

  public static readonly UUID: string = "00000026-0000-1000-8000-0026BB765291";

  constructor() {
    super("Outlet In Use", OutletInUse.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.OutletInUse = OutletInUse;

/**
 * Characteristic "Ozone Density"
 */
export class OzoneDensity extends Characteristic {

  public static readonly UUID: string = "000000C3-0000-1000-8000-0026BB765291";

  constructor() {
    super("Ozone Density", OzoneDensity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.OzoneDensity = OzoneDensity;

/**
 * Characteristic "Pairing Features"
 */
export class PairingFeatures extends Characteristic {

  public static readonly UUID: string = "0000004F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Pairing Features", PairingFeatures.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PairingFeatures = PairingFeatures;

/**
 * Characteristic "Pair Setup"
 */
export class PairSetup extends Characteristic {

  public static readonly UUID: string = "0000004C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Pair Setup", PairSetup.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PairSetup = PairSetup;

/**
 * Characteristic "Pair Verify"
 */
export class PairVerify extends Characteristic {

  public static readonly UUID: string = "0000004E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Pair Verify", PairVerify.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PairVerify = PairVerify;

/**
 * Characteristic "Password Setting"
 */
export class PasswordSetting extends Characteristic {

  public static readonly UUID: string = "000000E4-0000-1000-8000-0026BB765291";

  constructor() {
    super("Password Setting", PasswordSetting.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PasswordSetting = PasswordSetting;

/**
 * Characteristic "Periodic Snapshots Active"
 */
export class PeriodicSnapshotsActive extends Characteristic {

  public static readonly UUID: string = "00000225-0000-1000-8000-0026BB765291";

  public static readonly DISABLE = 0;
  public static readonly ENABLE = 1;

  constructor() {
    super("Periodic Snapshots Active", PeriodicSnapshotsActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PeriodicSnapshotsActive = PeriodicSnapshotsActive;

/**
 * Characteristic "Picture Mode"
 */
export class PictureMode extends Characteristic {

  public static readonly UUID: string = "000000E2-0000-1000-8000-0026BB765291";

  public static readonly OTHER = 0;
  public static readonly STANDARD = 1;
  public static readonly CALIBRATED = 2;
  public static readonly CALIBRATED_DARK = 3;
  public static readonly VIVID = 4;
  public static readonly GAME = 5;
  public static readonly COMPUTER = 6;
  public static readonly CUSTOM = 7;

  constructor() {
    super("Picture Mode", PictureMode.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 13,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PictureMode = PictureMode;

/**
 * Characteristic "Ping"
 * @since iOS 14
 */
export class Ping extends Characteristic {

  public static readonly UUID: string = "0000023C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Ping", Ping.UUID, {
      format: Formats.DATA,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Ping = Ping;

/**
 * Characteristic "PM10 Density"
 */
export class PM10Density extends Characteristic {

  public static readonly UUID: string = "000000C7-0000-1000-8000-0026BB765291";

  constructor() {
    super("PM10 Density", PM10Density.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PM10Density = PM10Density;

/**
 * Characteristic "PM2.5 Density"
 */
export class PM2_5Density extends Characteristic {

  public static readonly UUID: string = "000000C6-0000-1000-8000-0026BB765291";

  constructor() {
    super("PM2.5 Density", PM2_5Density.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PM2_5Density = PM2_5Density;

/**
 * Characteristic "Position State"
 */
export class PositionState extends Characteristic {

  public static readonly UUID: string = "00000072-0000-1000-8000-0026BB765291";

  public static readonly DECREASING = 0;
  public static readonly INCREASING = 1;
  public static readonly STOPPED = 2;

  constructor() {
    super("Position State", PositionState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PositionState = PositionState;

/**
 * Characteristic "Power Mode Selection"
 */
export class PowerModeSelection extends Characteristic {

  public static readonly UUID: string = "000000DF-0000-1000-8000-0026BB765291";

  public static readonly SHOW = 0;
  public static readonly HIDE = 1;

  constructor() {
    super("Power Mode Selection", PowerModeSelection.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.PowerModeSelection = PowerModeSelection;

/**
 * Characteristic "Product Data"
 */
export class ProductData extends Characteristic {

  public static readonly UUID: string = "00000220-0000-1000-8000-0026BB765291";

  constructor() {
    super("Product Data", ProductData.UUID, {
      format: Formats.DATA,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ProductData = ProductData;

/**
 * Characteristic "Programmable Switch Event"
 */
export class ProgrammableSwitchEvent extends Characteristic {

  public static readonly UUID: string = "00000073-0000-1000-8000-0026BB765291";

  public static readonly SINGLE_PRESS = 0;
  public static readonly DOUBLE_PRESS = 1;
  public static readonly LONG_PRESS = 2;

  constructor() {
    super("Programmable Switch Event", ProgrammableSwitchEvent.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ProgrammableSwitchEvent = ProgrammableSwitchEvent;

/**
 * Characteristic "Programmable Switch Output State"
 */
export class ProgrammableSwitchOutputState extends Characteristic {

  public static readonly UUID: string = "00000074-0000-1000-8000-0026BB765291";

  constructor() {
    super("Programmable Switch Output State", ProgrammableSwitchOutputState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ProgrammableSwitchOutputState = ProgrammableSwitchOutputState;

/**
 * Characteristic "Program Mode"
 */
export class ProgramMode extends Characteristic {

  public static readonly UUID: string = "000000D1-0000-1000-8000-0026BB765291";

  public static readonly NO_PROGRAM_SCHEDULED = 0;
  public static readonly PROGRAM_SCHEDULED = 1;
  public static readonly PROGRAM_SCHEDULED_MANUAL_MODE_ = 2;

  constructor() {
    super("Program Mode", ProgramMode.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ProgramMode = ProgramMode;

/**
 * Characteristic "Reachable"
 * @deprecated Removed and not used anymore
 */
export class Reachable extends Characteristic {

  public static readonly UUID: string = "00000063-0000-1000-8000-0026BB765291";

  constructor() {
    super("Reachable", Reachable.UUID, {
      format: Formats.BOOL,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.Reachable = Reachable;

/**
 * Characteristic "Received Signal Strength Indication"
 * @since iOS 14
 */
export class ReceivedSignalStrengthIndication extends Characteristic {

  public static readonly UUID: string = "0000023F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Received Signal Strength Indication", ReceivedSignalStrengthIndication.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ReceivedSignalStrengthIndication = ReceivedSignalStrengthIndication;

/**
 * Characteristic "Receiver Sensitivity"
 * @since iOS 14
 */
export class ReceiverSensitivity extends Characteristic {

  public static readonly UUID: string = "00000244-0000-1000-8000-0026BB765291";

  constructor() {
    super("Receiver Sensitivity", ReceiverSensitivity.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ReceiverSensitivity = ReceiverSensitivity;

/**
 * Characteristic "Recording Audio Active"
 */
export class RecordingAudioActive extends Characteristic {

  public static readonly UUID: string = "00000226-0000-1000-8000-0026BB765291";

  public static readonly DISABLE = 0;
  public static readonly ENABLE = 1;

  constructor() {
    super("Recording Audio Active", RecordingAudioActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE],
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RecordingAudioActive = RecordingAudioActive;

/**
 * Characteristic "Relative Humidity Dehumidifier Threshold"
 */
export class RelativeHumidityDehumidifierThreshold extends Characteristic {

  public static readonly UUID: string = "000000C9-0000-1000-8000-0026BB765291";

  constructor() {
    super("Relative Humidity Dehumidifier Threshold", RelativeHumidityDehumidifierThreshold.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RelativeHumidityDehumidifierThreshold = RelativeHumidityDehumidifierThreshold;

/**
 * Characteristic "Relative Humidity Humidifier Threshold"
 */
export class RelativeHumidityHumidifierThreshold extends Characteristic {

  public static readonly UUID: string = "000000CA-0000-1000-8000-0026BB765291";

  constructor() {
    super("Relative Humidity Humidifier Threshold", RelativeHumidityHumidifierThreshold.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RelativeHumidityHumidifierThreshold = RelativeHumidityHumidifierThreshold;

/**
 * Characteristic "Relay Control Point"
 */
export class RelayControlPoint extends Characteristic {

  public static readonly UUID: string = "0000005E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Relay Control Point", RelayControlPoint.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RelayControlPoint = RelayControlPoint;

/**
 * Characteristic "Relay Enabled"
 */
export class RelayEnabled extends Characteristic {

  public static readonly UUID: string = "0000005B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Relay Enabled", RelayEnabled.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RelayEnabled = RelayEnabled;

/**
 * Characteristic "Relay State"
 */
export class RelayState extends Characteristic {

  public static readonly UUID: string = "0000005C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Relay State", RelayState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 5,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RelayState = RelayState;

/**
 * Characteristic "Remaining Duration"
 */
export class RemainingDuration extends Characteristic {

  public static readonly UUID: string = "000000D4-0000-1000-8000-0026BB765291";

  constructor() {
    super("Remaining Duration", RemainingDuration.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.SECONDS,
      minValue: 0,
      maxValue: 3600,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RemainingDuration = RemainingDuration;

/**
 * Characteristic "Remote Key"
 */
export class RemoteKey extends Characteristic {

  public static readonly UUID: string = "000000E1-0000-1000-8000-0026BB765291";

  public static readonly REWIND = 0;
  public static readonly FAST_FORWARD = 1;
  public static readonly NEXT_TRACK = 2;
  public static readonly PREVIOUS_TRACK = 3;
  public static readonly ARROW_UP = 4;
  public static readonly ARROW_DOWN = 5;
  public static readonly ARROW_LEFT = 6;
  public static readonly ARROW_RIGHT = 7;
  public static readonly SELECT = 8;
  public static readonly BACK = 9;
  public static readonly EXIT = 10;
  public static readonly PLAY_PAUSE = 11;
  public static readonly INFORMATION = 15;

  constructor() {
    super("Remote Key", RemoteKey.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 16,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RemoteKey = RemoteKey;

/**
 * Characteristic "Reset Filter Indication"
 */
export class ResetFilterIndication extends Characteristic {

  public static readonly UUID: string = "000000AD-0000-1000-8000-0026BB765291";

  constructor() {
    super("Reset Filter Indication", ResetFilterIndication.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_WRITE],
      minValue: 1,
      maxValue: 1,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ResetFilterIndication = ResetFilterIndication;

/**
 * Characteristic "Rotation Direction"
 */
export class RotationDirection extends Characteristic {

  public static readonly UUID: string = "00000028-0000-1000-8000-0026BB765291";

  public static readonly CLOCKWISE = 0;
  public static readonly COUNTER_CLOCKWISE = 1;

  constructor() {
    super("Rotation Direction", RotationDirection.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RotationDirection = RotationDirection;

/**
 * Characteristic "Rotation Speed"
 */
export class RotationSpeed extends Characteristic {

  public static readonly UUID: string = "00000029-0000-1000-8000-0026BB765291";

  constructor() {
    super("Rotation Speed", RotationSpeed.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RotationSpeed = RotationSpeed;

/**
 * Characteristic "Router Status"
 */
export class RouterStatus extends Characteristic {

  public static readonly UUID: string = "0000020E-0000-1000-8000-0026BB765291";

  public static readonly READY = 0;
  public static readonly NOT_READY = 1;

  constructor() {
    super("Router Status", RouterStatus.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.RouterStatus = RouterStatus;

/**
 * Characteristic "Saturation"
 */
export class Saturation extends Characteristic {

  public static readonly UUID: string = "0000002F-0000-1000-8000-0026BB765291";

  constructor() {
    super("Saturation", Saturation.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Saturation = Saturation;

/**
 * Characteristic "Security System Alarm Type"
 */
export class SecuritySystemAlarmType extends Characteristic {

  public static readonly UUID: string = "0000008E-0000-1000-8000-0026BB765291";

  constructor() {
    super("Security System Alarm Type", SecuritySystemAlarmType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SecuritySystemAlarmType = SecuritySystemAlarmType;

/**
 * Characteristic "Security System Current State"
 */
export class SecuritySystemCurrentState extends Characteristic {

  public static readonly UUID: string = "00000066-0000-1000-8000-0026BB765291";

  public static readonly STAY_ARM = 0;
  public static readonly AWAY_ARM = 1;
  public static readonly NIGHT_ARM = 2;
  public static readonly DISARMED = 3;
  public static readonly ALARM_TRIGGERED = 4;

  constructor() {
    super("Security System Current State", SecuritySystemCurrentState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 4,
      minStep: 1,
      validValues: [0, 1, 2, 3, 4],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SecuritySystemCurrentState = SecuritySystemCurrentState;

/**
 * Characteristic "Security System Target State"
 */
export class SecuritySystemTargetState extends Characteristic {

  public static readonly UUID: string = "00000067-0000-1000-8000-0026BB765291";

  public static readonly STAY_ARM = 0;
  public static readonly AWAY_ARM = 1;
  public static readonly NIGHT_ARM = 2;
  public static readonly DISARM = 3;

  constructor() {
    super("Security System Target State", SecuritySystemTargetState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SecuritySystemTargetState = SecuritySystemTargetState;

/**
 * Characteristic "Selected Audio Stream Configuration"
 */
export class SelectedAudioStreamConfiguration extends Characteristic {

  public static readonly UUID: string = "00000128-0000-1000-8000-0026BB765291";

  constructor() {
    super("Selected Audio Stream Configuration", SelectedAudioStreamConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SelectedAudioStreamConfiguration = SelectedAudioStreamConfiguration;

/**
 * Characteristic "Selected Camera Recording Configuration"
 */
export class SelectedCameraRecordingConfiguration extends Characteristic {

  public static readonly UUID: string = "00000209-0000-1000-8000-0026BB765291";

  constructor() {
    super("Selected Camera Recording Configuration", SelectedCameraRecordingConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SelectedCameraRecordingConfiguration = SelectedCameraRecordingConfiguration;

/**
 * Characteristic "Selected RTP Stream Configuration"
 */
export class SelectedRTPStreamConfiguration extends Characteristic {

  public static readonly UUID: string = "00000117-0000-1000-8000-0026BB765291";

  constructor() {
    super("Selected RTP Stream Configuration", SelectedRTPStreamConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SelectedRTPStreamConfiguration = SelectedRTPStreamConfiguration;

/**
 * Characteristic "Serial Number"
 */
export class SerialNumber extends Characteristic {

  public static readonly UUID: string = "00000030-0000-1000-8000-0026BB765291";

  constructor() {
    super("Serial Number", SerialNumber.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
      maxLen: 64,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SerialNumber = SerialNumber;

/**
 * Characteristic "Service Label Index"
 */
export class ServiceLabelIndex extends Characteristic {

  public static readonly UUID: string = "000000CB-0000-1000-8000-0026BB765291";

  constructor() {
    super("Service Label Index", ServiceLabelIndex.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
      minValue: 1,
      maxValue: 255,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ServiceLabelIndex = ServiceLabelIndex;

/**
 * Characteristic "Service Label Namespace"
 */
export class ServiceLabelNamespace extends Characteristic {

  public static readonly UUID: string = "000000CD-0000-1000-8000-0026BB765291";

  public static readonly DOTS = 0;
  public static readonly ARABIC_NUMERALS = 1;

  constructor() {
    super("Service Label Namespace", ServiceLabelNamespace.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ServiceLabelNamespace = ServiceLabelNamespace;

/**
 * Characteristic "Set Duration"
 */
export class SetDuration extends Characteristic {

  public static readonly UUID: string = "000000D3-0000-1000-8000-0026BB765291";

  constructor() {
    super("Set Duration", SetDuration.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.SECONDS,
      minValue: 0,
      maxValue: 3600,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SetDuration = SetDuration;

/**
 * Characteristic "Setup Data Stream Transport"
 */
export class SetupDataStreamTransport extends Characteristic {

  public static readonly UUID: string = "00000131-0000-1000-8000-0026BB765291";

  constructor() {
    super("Setup Data Stream Transport", SetupDataStreamTransport.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SetupDataStreamTransport = SetupDataStreamTransport;

/**
 * Characteristic "Setup Endpoints"
 */
export class SetupEndpoints extends Characteristic {

  public static readonly UUID: string = "00000118-0000-1000-8000-0026BB765291";

  constructor() {
    super("Setup Endpoints", SetupEndpoints.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SetupEndpoints = SetupEndpoints;

/**
 * Characteristic "Setup Transfer Transport"
 * @since iOS 13.4
 */
export class SetupTransferTransport extends Characteristic {

  public static readonly UUID: string = "00000201-0000-1000-8000-0026BB765291";

  constructor() {
    super("Setup Transfer Transport", SetupTransferTransport.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SetupTransferTransport = SetupTransferTransport;

/**
 * Characteristic "Signal To Noise Ratio"
 * @since iOS 14
 */
export class SignalToNoiseRatio extends Characteristic {

  public static readonly UUID: string = "00000241-0000-1000-8000-0026BB765291";

  constructor() {
    super("Signal To Noise Ratio", SignalToNoiseRatio.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SignalToNoiseRatio = SignalToNoiseRatio;

/**
 * Characteristic "Siri Input Type"
 */
export class SiriInputType extends Characteristic {

  public static readonly UUID: string = "00000132-0000-1000-8000-0026BB765291";

  public static readonly PUSH_BUTTON_TRIGGERED_APPLE_TV = 0;

  constructor() {
    super("Siri Input Type", SiriInputType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 0,
      validValues: [0],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SiriInputType = SiriInputType;

/**
 * Characteristic "Slat Type"
 */
export class SlatType extends Characteristic {

  public static readonly UUID: string = "000000C0-0000-1000-8000-0026BB765291";

  public static readonly HORIZONTAL = 0;
  public static readonly VERTICAL = 1;

  constructor() {
    super("Slat Type", SlatType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SlatType = SlatType;

/**
 * Characteristic "Sleep Discovery Mode"
 */
export class SleepDiscoveryMode extends Characteristic {

  public static readonly UUID: string = "000000E8-0000-1000-8000-0026BB765291";

  public static readonly NOT_DISCOVERABLE = 0;
  public static readonly ALWAYS_DISCOVERABLE = 1;

  constructor() {
    super("Sleep Discovery Mode", SleepDiscoveryMode.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SleepDiscoveryMode = SleepDiscoveryMode;

/**
 * Characteristic "Sleep Interval"
 * @since iOS 14
 */
export class SleepInterval extends Characteristic {

  public static readonly UUID: string = "0000023A-0000-1000-8000-0026BB765291";

  constructor() {
    super("Sleep Interval", SleepInterval.UUID, {
      format: Formats.UINT32,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SleepInterval = SleepInterval;

/**
 * Characteristic "Smoke Detected"
 */
export class SmokeDetected extends Characteristic {

  public static readonly UUID: string = "00000076-0000-1000-8000-0026BB765291";

  public static readonly SMOKE_NOT_DETECTED = 0;
  public static readonly SMOKE_DETECTED = 1;

  constructor() {
    super("Smoke Detected", SmokeDetected.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SmokeDetected = SmokeDetected;

/**
 * Characteristic "Software Revision"
 */
export class SoftwareRevision extends Characteristic {

  public static readonly UUID: string = "00000054-0000-1000-8000-0026BB765291";

  constructor() {
    super("Software Revision", SoftwareRevision.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SoftwareRevision = SoftwareRevision;

/**
 * Characteristic "Staged Firmware Version"
 */
export class StagedFirmwareVersion extends Characteristic {

  public static readonly UUID: string = "00000249-0000-1000-8000-0026BB765291";

  constructor() {
    super("Staged Firmware Version", StagedFirmwareVersion.UUID, {
      format: Formats.STRING,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StagedFirmwareVersion = StagedFirmwareVersion;

/**
 * Characteristic "Status Active"
 */
export class StatusActive extends Characteristic {

  public static readonly UUID: string = "00000075-0000-1000-8000-0026BB765291";

  constructor() {
    super("Status Active", StatusActive.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StatusActive = StatusActive;

/**
 * Characteristic "Status Fault"
 */
export class StatusFault extends Characteristic {

  public static readonly UUID: string = "00000077-0000-1000-8000-0026BB765291";

  public static readonly NO_FAULT = 0;
  public static readonly GENERAL_FAULT = 1;

  constructor() {
    super("Status Fault", StatusFault.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StatusFault = StatusFault;

/**
 * Characteristic "Status Jammed"
 */
export class StatusJammed extends Characteristic {

  public static readonly UUID: string = "00000078-0000-1000-8000-0026BB765291";

  public static readonly NOT_JAMMED = 0;
  public static readonly JAMMED = 1;

  constructor() {
    super("Status Jammed", StatusJammed.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StatusJammed = StatusJammed;

/**
 * Characteristic "Status Low Battery"
 */
export class StatusLowBattery extends Characteristic {

  public static readonly UUID: string = "00000079-0000-1000-8000-0026BB765291";

  public static readonly BATTERY_LEVEL_NORMAL = 0;
  public static readonly BATTERY_LEVEL_LOW = 1;

  constructor() {
    super("Status Low Battery", StatusLowBattery.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StatusLowBattery = StatusLowBattery;

/**
 * Characteristic "Status Tampered"
 */
export class StatusTampered extends Characteristic {

  public static readonly UUID: string = "0000007A-0000-1000-8000-0026BB765291";

  public static readonly NOT_TAMPERED = 0;
  public static readonly TAMPERED = 1;

  constructor() {
    super("Status Tampered", StatusTampered.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StatusTampered = StatusTampered;

/**
 * Characteristic "Streaming Status"
 */
export class StreamingStatus extends Characteristic {

  public static readonly UUID: string = "00000120-0000-1000-8000-0026BB765291";

  constructor() {
    super("Streaming Status", StreamingStatus.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.StreamingStatus = StreamingStatus;

/**
 * Characteristic "Sulphur Dioxide Density"
 */
export class SulphurDioxideDensity extends Characteristic {

  public static readonly UUID: string = "000000C5-0000-1000-8000-0026BB765291";

  constructor() {
    super("Sulphur Dioxide Density", SulphurDioxideDensity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SulphurDioxideDensity = SulphurDioxideDensity;

/**
 * Characteristic "Supported Audio Recording Configuration"
 */
export class SupportedAudioRecordingConfiguration extends Characteristic {

  public static readonly UUID: string = "00000207-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Audio Recording Configuration", SupportedAudioRecordingConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedAudioRecordingConfiguration = SupportedAudioRecordingConfiguration;

/**
 * Characteristic "Supported Audio Stream Configuration"
 */
export class SupportedAudioStreamConfiguration extends Characteristic {

  public static readonly UUID: string = "00000115-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Audio Stream Configuration", SupportedAudioStreamConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedAudioStreamConfiguration = SupportedAudioStreamConfiguration;

/**
 * Characteristic "Supported Camera Recording Configuration"
 */
export class SupportedCameraRecordingConfiguration extends Characteristic {

  public static readonly UUID: string = "00000205-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Camera Recording Configuration", SupportedCameraRecordingConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedCameraRecordingConfiguration = SupportedCameraRecordingConfiguration;

/**
 * Characteristic "Supported Characteristic Value Transition Configuration"
 * @since iOS 14
 */
export class SupportedCharacteristicValueTransitionConfiguration extends Characteristic {

  public static readonly UUID: string = "00000144-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Characteristic Value Transition Configuration", SupportedCharacteristicValueTransitionConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedCharacteristicValueTransitionConfiguration = SupportedCharacteristicValueTransitionConfiguration;

/**
 * Characteristic "Supported Data Stream Transport Configuration"
 */
export class SupportedDataStreamTransportConfiguration extends Characteristic {

  public static readonly UUID: string = "00000130-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Data Stream Transport Configuration", SupportedDataStreamTransportConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedDataStreamTransportConfiguration = SupportedDataStreamTransportConfiguration;

/**
 * Characteristic "Supported Diagnostics Snapshot"
 * @since iOS 14
 */
export class SupportedDiagnosticsSnapshot extends Characteristic {

  public static readonly UUID: string = "00000238-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Diagnostics Snapshot", SupportedDiagnosticsSnapshot.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedDiagnosticsSnapshot = SupportedDiagnosticsSnapshot;

/**
 * Characteristic "Supported Firmware Update Configuration"
 */
export class SupportedFirmwareUpdateConfiguration extends Characteristic {

  public static readonly UUID: string = "00000233-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Firmware Update Configuration", SupportedFirmwareUpdateConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedFirmwareUpdateConfiguration = SupportedFirmwareUpdateConfiguration;

/**
 * Characteristic "Supported Router Configuration"
 */
export class SupportedRouterConfiguration extends Characteristic {

  public static readonly UUID: string = "00000210-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Router Configuration", SupportedRouterConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedRouterConfiguration = SupportedRouterConfiguration;

/**
 * Characteristic "Supported RTP Configuration"
 */
export class SupportedRTPConfiguration extends Characteristic {

  public static readonly UUID: string = "00000116-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported RTP Configuration", SupportedRTPConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedRTPConfiguration = SupportedRTPConfiguration;

/**
 * Characteristic "Supported Transfer Transport Configuration"
 * @since iOS 13.4
 */
export class SupportedTransferTransportConfiguration extends Characteristic {

  public static readonly UUID: string = "00000202-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Transfer Transport Configuration", SupportedTransferTransportConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedTransferTransportConfiguration = SupportedTransferTransportConfiguration;

/**
 * Characteristic "Supported Video Recording Configuration"
 */
export class SupportedVideoRecordingConfiguration extends Characteristic {

  public static readonly UUID: string = "00000206-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Video Recording Configuration", SupportedVideoRecordingConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedVideoRecordingConfiguration = SupportedVideoRecordingConfiguration;

/**
 * Characteristic "Supported Video Stream Configuration"
 */
export class SupportedVideoStreamConfiguration extends Characteristic {

  public static readonly UUID: string = "00000114-0000-1000-8000-0026BB765291";

  constructor() {
    super("Supported Video Stream Configuration", SupportedVideoStreamConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SupportedVideoStreamConfiguration = SupportedVideoStreamConfiguration;

/**
 * Characteristic "Swing Mode"
 */
export class SwingMode extends Characteristic {

  public static readonly UUID: string = "000000B6-0000-1000-8000-0026BB765291";

  public static readonly SWING_DISABLED = 0;
  public static readonly SWING_ENABLED = 1;

  constructor() {
    super("Swing Mode", SwingMode.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.SwingMode = SwingMode;

/**
 * Characteristic "Target Air Purifier State"
 */
export class TargetAirPurifierState extends Characteristic {

  public static readonly UUID: string = "000000A8-0000-1000-8000-0026BB765291";

  public static readonly MANUAL = 0;
  public static readonly AUTO = 1;

  constructor() {
    super("Target Air Purifier State", TargetAirPurifierState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetAirPurifierState = TargetAirPurifierState;

/**
 * Characteristic "Target Air Quality"
 * @deprecated Removed and not used anymore
 */
export class TargetAirQuality extends Characteristic {

  public static readonly UUID: string = "000000AE-0000-1000-8000-0026BB765291";

  public static readonly EXCELLENT = 0;
  public static readonly GOOD = 1;
  public static readonly FAIR = 2;

  constructor() {
    super("Target Air Quality", TargetAirQuality.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 2,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.TargetAirQuality = TargetAirQuality;

/**
 * Characteristic "Target Control List"
 */
export class TargetControlList extends Characteristic {

  public static readonly UUID: string = "00000124-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Control List", TargetControlList.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.WRITE_RESPONSE],
      adminOnlyAccess: [Access.READ, Access.WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetControlList = TargetControlList;

/**
 * Characteristic "Target Control Supported Configuration"
 */
export class TargetControlSupportedConfiguration extends Characteristic {

  public static readonly UUID: string = "00000123-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Control Supported Configuration", TargetControlSupportedConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetControlSupportedConfiguration = TargetControlSupportedConfiguration;

/**
 * Characteristic "Target Door State"
 */
export class TargetDoorState extends Characteristic {

  public static readonly UUID: string = "00000032-0000-1000-8000-0026BB765291";

  public static readonly OPEN = 0;
  public static readonly CLOSED = 1;

  constructor() {
    super("Target Door State", TargetDoorState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetDoorState = TargetDoorState;

/**
 * Characteristic "Target Fan State"
 */
export class TargetFanState extends Characteristic {

  public static readonly UUID: string = "000000BF-0000-1000-8000-0026BB765291";

  public static readonly MANUAL = 0;
  public static readonly AUTO = 1;

  constructor() {
    super("Target Fan State", TargetFanState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetFanState = TargetFanState;

/**
 * Characteristic "Target Heater-Cooler State"
 */
export class TargetHeaterCoolerState extends Characteristic {

  public static readonly UUID: string = "000000B2-0000-1000-8000-0026BB765291";

  public static readonly AUTO = 0;
  public static readonly HEAT = 1;
  public static readonly COOL = 2;

  constructor() {
    super("Target Heater-Cooler State", TargetHeaterCoolerState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetHeaterCoolerState = TargetHeaterCoolerState;

/**
 * Characteristic "Target Heating Cooling State"
 */
export class TargetHeatingCoolingState extends Characteristic {

  public static readonly UUID: string = "00000033-0000-1000-8000-0026BB765291";

  public static readonly OFF = 0;
  public static readonly HEAT = 1;
  public static readonly COOL = 2;
  public static readonly AUTO = 3;

  constructor() {
    super("Target Heating Cooling State", TargetHeatingCoolingState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetHeatingCoolingState = TargetHeatingCoolingState;

/**
 * Characteristic "Target Horizontal Tilt Angle"
 */
export class TargetHorizontalTiltAngle extends Characteristic {

  public static readonly UUID: string = "0000007B-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Horizontal Tilt Angle", TargetHorizontalTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetHorizontalTiltAngle = TargetHorizontalTiltAngle;

/**
 * Characteristic "Target Humidifier-Dehumidifier State"
 */
export class TargetHumidifierDehumidifierState extends Characteristic {

  public static readonly UUID: string = "000000B4-0000-1000-8000-0026BB765291";

  /**
   * @deprecated Removed in iOS 11. Use {@link HUMIDIFIER_OR_DEHUMIDIFIER} instead.
   */
  public static readonly AUTO = 0;

  public static readonly HUMIDIFIER_OR_DEHUMIDIFIER = 0;
  public static readonly HUMIDIFIER = 1;
  public static readonly DEHUMIDIFIER = 2;

  constructor() {
    super("Target Humidifier-Dehumidifier State", TargetHumidifierDehumidifierState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetHumidifierDehumidifierState = TargetHumidifierDehumidifierState;

/**
 * Characteristic "Target Media State"
 */
export class TargetMediaState extends Characteristic {

  public static readonly UUID: string = "00000137-0000-1000-8000-0026BB765291";

  public static readonly PLAY = 0;
  public static readonly PAUSE = 1;
  public static readonly STOP = 2;

  constructor() {
    super("Target Media State", TargetMediaState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 2,
      minStep: 1,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetMediaState = TargetMediaState;

/**
 * Characteristic "Target Position"
 */
export class TargetPosition extends Characteristic {

  public static readonly UUID: string = "0000007C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Position", TargetPosition.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetPosition = TargetPosition;

/**
 * Characteristic "Target Relative Humidity"
 */
export class TargetRelativeHumidity extends Characteristic {

  public static readonly UUID: string = "00000034-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Relative Humidity", TargetRelativeHumidity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetRelativeHumidity = TargetRelativeHumidity;

/**
 * Characteristic "Target Slat State"
 * @deprecated Removed and not used anymore
 */
export class TargetSlatState extends Characteristic {

  public static readonly UUID: string = "000000BE-0000-1000-8000-0026BB765291";

  public static readonly MANUAL = 0;
  public static readonly AUTO = 1;

  constructor() {
    super("Target Slat State", TargetSlatState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.TargetSlatState = TargetSlatState;

/**
 * Characteristic "Target Temperature"
 */
export class TargetTemperature extends Characteristic {

  public static readonly UUID: string = "00000035-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Temperature", TargetTemperature.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.CELSIUS,
      minValue: 10,
      maxValue: 38,
      minStep: 0.1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetTemperature = TargetTemperature;

/**
 * Characteristic "Target Tilt Angle"
 */
export class TargetTiltAngle extends Characteristic {

  public static readonly UUID: string = "000000C2-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Tilt Angle", TargetTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetTiltAngle = TargetTiltAngle;

/**
 * Characteristic "Target Vertical Tilt Angle"
 */
export class TargetVerticalTiltAngle extends Characteristic {

  public static readonly UUID: string = "0000007D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Target Vertical Tilt Angle", TargetVerticalTiltAngle.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.ARC_DEGREE,
      minValue: -90,
      maxValue: 90,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetVerticalTiltAngle = TargetVerticalTiltAngle;

/**
 * Characteristic "Target Visibility State"
 */
export class TargetVisibilityState extends Characteristic {

  public static readonly UUID: string = "00000134-0000-1000-8000-0026BB765291";

  public static readonly SHOWN = 0;
  public static readonly HIDDEN = 1;

  constructor() {
    super("Target Visibility State", TargetVisibilityState.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TargetVisibilityState = TargetVisibilityState;

/**
 * Characteristic "Temperature Display Units"
 */
export class TemperatureDisplayUnits extends Characteristic {

  public static readonly UUID: string = "00000036-0000-1000-8000-0026BB765291";

  public static readonly CELSIUS = 0;
  public static readonly FAHRENHEIT = 1;

  constructor() {
    super("Temperature Display Units", TemperatureDisplayUnits.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TemperatureDisplayUnits = TemperatureDisplayUnits;

/**
 * Characteristic "Third Party Camera Active"
 */
export class ThirdPartyCameraActive extends Characteristic {

  public static readonly UUID: string = "0000021C-0000-1000-8000-0026BB765291";

  public static readonly OFF = 0;
  public static readonly ON = 1;

  constructor() {
    super("Third Party Camera Active", ThirdPartyCameraActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ThirdPartyCameraActive = ThirdPartyCameraActive;

/**
 * Characteristic "Thread Control Point"
 */
export class ThreadControlPoint extends Characteristic {

  public static readonly UUID: string = "00000704-0000-1000-8000-0026BB765291";

  constructor() {
    super("Thread Control Point", ThreadControlPoint.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ThreadControlPoint = ThreadControlPoint;

/**
 * Characteristic "Thread Node Capabilities"
 */
export class ThreadNodeCapabilities extends Characteristic {

  public static readonly UUID: string = "00000702-0000-1000-8000-0026BB765291";

  constructor() {
    super("Thread Node Capabilities", ThreadNodeCapabilities.UUID, {
      format: Formats.UINT16,
      perms: [Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 31,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ThreadNodeCapabilities = ThreadNodeCapabilities;

/**
 * Characteristic "Thread OpenThread Version"
 */
export class ThreadOpenThreadVersion extends Characteristic {

  public static readonly UUID: string = "00000706-0000-1000-8000-0026BB765291";

  constructor() {
    super("Thread OpenThread Version", ThreadOpenThreadVersion.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ThreadOpenThreadVersion = ThreadOpenThreadVersion;

/**
 * Characteristic "Thread Status"
 */
export class ThreadStatus extends Characteristic {

  public static readonly UUID: string = "00000703-0000-1000-8000-0026BB765291";

  constructor() {
    super("Thread Status", ThreadStatus.UUID, {
      format: Formats.UINT16,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 6,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ThreadStatus = ThreadStatus;

/**
 * Characteristic "Time Update"
 * @deprecated Removed and not used anymore
 */
export class TimeUpdate extends Characteristic {

  public static readonly UUID: string = "0000009A-0000-1000-8000-0026BB765291";

  constructor() {
    super("Time Update", TimeUpdate.UUID, {
      format: Formats.BOOL,
      perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
// noinspection JSDeprecatedSymbols
Characteristic.TimeUpdate = TimeUpdate;

/**
 * Characteristic "Transmit Power"
 * @since iOS 14
 */
export class TransmitPower extends Characteristic {

  public static readonly UUID: string = "00000242-0000-1000-8000-0026BB765291";

  constructor() {
    super("Transmit Power", TransmitPower.UUID, {
      format: Formats.INT,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TransmitPower = TransmitPower;

/**
 * Characteristic "Tunnel Connection Timeout"
 */
export class TunnelConnectionTimeout extends Characteristic {

  public static readonly UUID: string = "00000061-0000-1000-8000-0026BB765291";

  constructor() {
    super("Tunnel Connection Timeout", TunnelConnectionTimeout.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TunnelConnectionTimeout = TunnelConnectionTimeout;

/**
 * Characteristic "Tunneled Accessory Advertising"
 */
export class TunneledAccessoryAdvertising extends Characteristic {

  public static readonly UUID: string = "00000060-0000-1000-8000-0026BB765291";

  constructor() {
    super("Tunneled Accessory Advertising", TunneledAccessoryAdvertising.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TunneledAccessoryAdvertising = TunneledAccessoryAdvertising;

/**
 * Characteristic "Tunneled Accessory Connected"
 */
export class TunneledAccessoryConnected extends Characteristic {

  public static readonly UUID: string = "00000059-0000-1000-8000-0026BB765291";

  constructor() {
    super("Tunneled Accessory Connected", TunneledAccessoryConnected.UUID, {
      format: Formats.BOOL,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TunneledAccessoryConnected = TunneledAccessoryConnected;

/**
 * Characteristic "Tunneled Accessory State Number"
 */
export class TunneledAccessoryStateNumber extends Characteristic {

  public static readonly UUID: string = "00000058-0000-1000-8000-0026BB765291";

  constructor() {
    super("Tunneled Accessory State Number", TunneledAccessoryStateNumber.UUID, {
      format: Formats.INT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.TunneledAccessoryStateNumber = TunneledAccessoryStateNumber;

/**
 * Characteristic "Valve Type"
 */
export class ValveType extends Characteristic {

  public static readonly UUID: string = "000000D5-0000-1000-8000-0026BB765291";

  public static readonly GENERIC_VALVE = 0;
  public static readonly IRRIGATION = 1;
  public static readonly SHOWER_HEAD = 2;
  public static readonly WATER_FAUCET = 3;

  constructor() {
    super("Valve Type", ValveType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.ValveType = ValveType;

/**
 * Characteristic "Version"
 */
export class Version extends Characteristic {

  public static readonly UUID: string = "00000037-0000-1000-8000-0026BB765291";

  constructor() {
    super("Version", Version.UUID, {
      format: Formats.STRING,
      perms: [Perms.PAIRED_READ],
      maxLen: 64,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Version = Version;

/**
 * Characteristic "Video Analysis Active"
 * @since iOS 14
 */
export class VideoAnalysisActive extends Characteristic {

  public static readonly UUID: string = "00000229-0000-1000-8000-0026BB765291";

  constructor() {
    super("Video Analysis Active", VideoAnalysisActive.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.VideoAnalysisActive = VideoAnalysisActive;

/**
 * Characteristic "VOC Density"
 */
export class VOCDensity extends Characteristic {

  public static readonly UUID: string = "000000C8-0000-1000-8000-0026BB765291";

  constructor() {
    super("VOC Density", VOCDensity.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 1000,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.VOCDensity = VOCDensity;

/**
 * Characteristic "Volume"
 */
export class Volume extends Characteristic {

  public static readonly UUID: string = "00000119-0000-1000-8000-0026BB765291";

  constructor() {
    super("Volume", Volume.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.Volume = Volume;

/**
 * Characteristic "Volume Control Type"
 */
export class VolumeControlType extends Characteristic {

  public static readonly UUID: string = "000000E9-0000-1000-8000-0026BB765291";

  public static readonly NONE = 0;
  public static readonly RELATIVE = 1;
  public static readonly RELATIVE_WITH_CURRENT = 2;
  public static readonly ABSOLUTE = 3;

  constructor() {
    super("Volume Control Type", VolumeControlType.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 3,
      minStep: 1,
      validValues: [0, 1, 2, 3],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.VolumeControlType = VolumeControlType;

/**
 * Characteristic "Volume Selector"
 */
export class VolumeSelector extends Characteristic {

  public static readonly UUID: string = "000000EA-0000-1000-8000-0026BB765291";

  public static readonly INCREMENT = 0;
  public static readonly DECREMENT = 1;

  constructor() {
    super("Volume Selector", VolumeSelector.UUID, {
      format: Formats.UINT8,
      perms: [Perms.PAIRED_WRITE],
      minValue: 0,
      maxValue: 1,
      minStep: 1,
      validValues: [0, 1],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.VolumeSelector = VolumeSelector;

/**
 * Characteristic "Wake Configuration"
 * @since iOS 13.4
 */
export class WakeConfiguration extends Characteristic {

  public static readonly UUID: string = "00000222-0000-1000-8000-0026BB765291";

  constructor() {
    super("Wake Configuration", WakeConfiguration.UUID, {
      format: Formats.TLV8,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WakeConfiguration = WakeConfiguration;

/**
 * Characteristic "WAN Configuration List"
 */
export class WANConfigurationList extends Characteristic {

  public static readonly UUID: string = "00000211-0000-1000-8000-0026BB765291";

  constructor() {
    super("WAN Configuration List", WANConfigurationList.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WANConfigurationList = WANConfigurationList;

/**
 * Characteristic "WAN Status List"
 */
export class WANStatusList extends Characteristic {

  public static readonly UUID: string = "00000212-0000-1000-8000-0026BB765291";

  constructor() {
    super("WAN Status List", WANStatusList.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WANStatusList = WANStatusList;

/**
 * Characteristic "Water Level"
 */
export class WaterLevel extends Characteristic {

  public static readonly UUID: string = "000000B5-0000-1000-8000-0026BB765291";

  constructor() {
    super("Water Level", WaterLevel.UUID, {
      format: Formats.FLOAT,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      unit: Units.PERCENTAGE,
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WaterLevel = WaterLevel;

/**
 * Characteristic "Wi-Fi Capabilities"
 * @since iOS 14
 */
export class WiFiCapabilities extends Characteristic {

  public static readonly UUID: string = "0000022C-0000-1000-8000-0026BB765291";

  constructor() {
    super("Wi-Fi Capabilities", WiFiCapabilities.UUID, {
      format: Formats.UINT32,
      perms: [Perms.PAIRED_READ],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WiFiCapabilities = WiFiCapabilities;

/**
 * Characteristic "Wi-Fi Configuration Control"
 * @since iOS 14
 */
export class WiFiConfigurationControl extends Characteristic {

  public static readonly UUID: string = "0000022D-0000-1000-8000-0026BB765291";

  constructor() {
    super("Wi-Fi Configuration Control", WiFiConfigurationControl.UUID, {
      format: Formats.TLV8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.TIMED_WRITE, Perms.WRITE_RESPONSE],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WiFiConfigurationControl = WiFiConfigurationControl;

/**
 * Characteristic "Wi-Fi Satellite Status"
 */
export class WiFiSatelliteStatus extends Characteristic {

  public static readonly UUID: string = "0000021E-0000-1000-8000-0026BB765291";

  public static readonly UNKNOWN = 0;
  public static readonly CONNECTED = 1;
  public static readonly NOT_CONNECTED = 2;

  constructor() {
    super("Wi-Fi Satellite Status", WiFiSatelliteStatus.UUID, {
      format: Formats.UINT8,
      perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      minValue: 0,
      maxValue: 2,
      validValues: [0, 1, 2],
    });
    this.value = this.getDefaultValue();
  }
}
Characteristic.WiFiSatelliteStatus = WiFiSatelliteStatus;

