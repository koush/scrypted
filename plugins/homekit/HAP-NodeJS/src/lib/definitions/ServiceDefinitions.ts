// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY
// V=876

import { Characteristic } from "../Characteristic";
import { Service } from "../Service";

/**
 * Service "Access Code"
 * @since iOS 15
 */
export class AccessCode extends Service {

  public static readonly UUID: string = "00000260-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AccessCode.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.AccessCodeControlPoint);
    this.addCharacteristic(Characteristic.AccessCodeSupportedConfiguration);
    this.addCharacteristic(Characteristic.ConfigurationState);
  }
}
Service.AccessCode = AccessCode;

/**
 * Service "Access Control"
 */
export class AccessControl extends Service {

  public static readonly UUID: string = "000000DA-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AccessControl.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.AccessControlLevel);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.PasswordSetting);
  }
}
Service.AccessControl = AccessControl;

/**
 * Service "Accessory Information"
 */
export class AccessoryInformation extends Service {

  public static readonly UUID: string = "0000003E-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AccessoryInformation.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Identify);
    this.addCharacteristic(Characteristic.Manufacturer);
    this.addCharacteristic(Characteristic.Model);
    if (!this.testCharacteristic(Characteristic.Name)) { // workaround for Name characteristic collision in constructor
      this.addCharacteristic(Characteristic.Name).updateValue("Unnamed Service");
    }
    this.addCharacteristic(Characteristic.SerialNumber);
    this.addCharacteristic(Characteristic.FirmwareRevision);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.AccessoryFlags);
    this.addOptionalCharacteristic(Characteristic.AppMatchingIdentifier);
    this.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.addOptionalCharacteristic(Characteristic.HardwareFinish);
    this.addOptionalCharacteristic(Characteristic.HardwareRevision);
    this.addOptionalCharacteristic(Characteristic.ProductData);
    this.addOptionalCharacteristic(Characteristic.SoftwareRevision);
  }
}
Service.AccessoryInformation = AccessoryInformation;

/**
 * Service "Accessory Runtime Information"
 */
export class AccessoryRuntimeInformation extends Service {

  public static readonly UUID: string = "00000239-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AccessoryRuntimeInformation.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Ping);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.ActivityInterval);
    this.addOptionalCharacteristic(Characteristic.HeartBeat);
    this.addOptionalCharacteristic(Characteristic.SleepInterval);
  }
}
Service.AccessoryRuntimeInformation = AccessoryRuntimeInformation;

/**
 * Service "Air Purifier"
 */
export class AirPurifier extends Service {

  public static readonly UUID: string = "000000BB-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AirPurifier.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.CurrentAirPurifierState);
    this.addCharacteristic(Characteristic.TargetAirPurifierState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.LockPhysicalControls);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RotationSpeed);
    this.addOptionalCharacteristic(Characteristic.SwingMode);
  }
}
Service.AirPurifier = AirPurifier;

/**
 * Service "Air Quality Sensor"
 */
export class AirQualitySensor extends Service {

  public static readonly UUID: string = "0000008D-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AirQualitySensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.AirQuality);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.NitrogenDioxideDensity);
    this.addOptionalCharacteristic(Characteristic.OzoneDensity);
    this.addOptionalCharacteristic(Characteristic.PM10Density);
    this.addOptionalCharacteristic(Characteristic.PM2_5Density);
    this.addOptionalCharacteristic(Characteristic.SulphurDioxideDensity);
    this.addOptionalCharacteristic(Characteristic.VOCDensity);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.AirQualitySensor = AirQualitySensor;

/**
 * Service "Audio Stream Management"
 */
export class AudioStreamManagement extends Service {

  public static readonly UUID: string = "00000127-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, AudioStreamManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SupportedAudioStreamConfiguration);
    this.addCharacteristic(Characteristic.SelectedAudioStreamConfiguration);
  }
}
Service.AudioStreamManagement = AudioStreamManagement;

/**
 * Service "Battery"
 */
export class Battery extends Service {

  public static readonly UUID: string = "00000096-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Battery.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.StatusLowBattery);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.BatteryLevel);
    this.addOptionalCharacteristic(Characteristic.ChargingState);
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
// noinspection JSDeprecatedSymbols
Service.BatteryService = Battery;
Service.Battery = Battery;

/**
 * Service "Bridge Configuration"
 * @deprecated Removed and not used anymore
 */
export class BridgeConfiguration extends Service {

  public static readonly UUID: string = "000000A1-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, BridgeConfiguration.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ConfigureBridgedAccessoryStatus);
    this.addCharacteristic(Characteristic.DiscoverBridgedAccessories);
    this.addCharacteristic(Characteristic.DiscoveredBridgedAccessories);
    this.addCharacteristic(Characteristic.ConfigureBridgedAccessory);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
// noinspection JSDeprecatedSymbols
Service.BridgeConfiguration = BridgeConfiguration;

/**
 * Service "Bridging State"
 * @deprecated Removed and not used anymore
 */
export class BridgingState extends Service {

  public static readonly UUID: string = "00000062-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, BridgingState.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Reachable);
    this.addCharacteristic(Characteristic.LinkQuality);
    this.addCharacteristic(Characteristic.AccessoryIdentifier);
    this.addCharacteristic(Characteristic.Category);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
// noinspection JSDeprecatedSymbols
Service.BridgingState = BridgingState;

/**
 * Service "Camera Control"
 * @deprecated This service has no usage anymore and will be ignored by iOS
 */
export class CameraControl extends Service {

  public static readonly UUID: string = "00000111-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CameraControl.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.On);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CurrentHorizontalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.CurrentVerticalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.TargetHorizontalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.TargetVerticalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.NightVision);
    this.addOptionalCharacteristic(Characteristic.OpticalZoom);
    this.addOptionalCharacteristic(Characteristic.DigitalZoom);
    this.addOptionalCharacteristic(Characteristic.ImageRotation);
    this.addOptionalCharacteristic(Characteristic.ImageMirroring);
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
// noinspection JSDeprecatedSymbols
Service.CameraControl = CameraControl;

/**
 * Service "Camera Operating Mode"
 */
export class CameraOperatingMode extends Service {

  public static readonly UUID: string = "0000021A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CameraOperatingMode.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.EventSnapshotsActive);
    this.addCharacteristic(Characteristic.HomeKitCameraActive);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CameraOperatingModeIndicator);
    this.addOptionalCharacteristic(Characteristic.ManuallyDisabled);
    this.addOptionalCharacteristic(Characteristic.NightVision);
    this.addOptionalCharacteristic(Characteristic.PeriodicSnapshotsActive);
    this.addOptionalCharacteristic(Characteristic.ThirdPartyCameraActive);
    this.addOptionalCharacteristic(Characteristic.DiagonalFieldOfView);
  }
}
Service.CameraOperatingMode = CameraOperatingMode;

/**
 * Service "Camera Recording Management"
 */
export class CameraRecordingManagement extends Service {

  public static readonly UUID: string = "00000204-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CameraRecordingManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.SupportedCameraRecordingConfiguration);
    this.addCharacteristic(Characteristic.SupportedVideoRecordingConfiguration);
    this.addCharacteristic(Characteristic.SupportedAudioRecordingConfiguration);
    this.addCharacteristic(Characteristic.SelectedCameraRecordingConfiguration);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.RecordingAudioActive);
  }
}
// noinspection JSDeprecatedSymbols
Service.CameraEventRecordingManagement = CameraRecordingManagement;
Service.CameraRecordingManagement = CameraRecordingManagement;

/**
 * Service "Camera RTP Stream Management"
 */
export class CameraRTPStreamManagement extends Service {

  public static readonly UUID: string = "00000110-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CameraRTPStreamManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SelectedRTPStreamConfiguration);
    this.addCharacteristic(Characteristic.SetupEndpoints);
    this.addCharacteristic(Characteristic.StreamingStatus);
    this.addCharacteristic(Characteristic.SupportedAudioStreamConfiguration);
    this.addCharacteristic(Characteristic.SupportedRTPConfiguration);
    this.addCharacteristic(Characteristic.SupportedVideoStreamConfiguration);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Active);
  }
}
Service.CameraRTPStreamManagement = CameraRTPStreamManagement;

/**
 * Service "Carbon Dioxide Sensor"
 */
export class CarbonDioxideSensor extends Service {

  public static readonly UUID: string = "00000097-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CarbonDioxideSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CarbonDioxideDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CarbonDioxideLevel);
    this.addOptionalCharacteristic(Characteristic.CarbonDioxidePeakLevel);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.CarbonDioxideSensor = CarbonDioxideSensor;

/**
 * Service "Carbon Monoxide Sensor"
 */
export class CarbonMonoxideSensor extends Service {

  public static readonly UUID: string = "0000007F-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CarbonMonoxideSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CarbonMonoxideDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CarbonMonoxideLevel);
    this.addOptionalCharacteristic(Characteristic.CarbonMonoxidePeakLevel);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.CarbonMonoxideSensor = CarbonMonoxideSensor;

/**
 * Service "Cloud Relay"
 */
export class CloudRelay extends Service {

  public static readonly UUID: string = "0000005A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, CloudRelay.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.RelayControlPoint);
    this.addCharacteristic(Characteristic.RelayState);
    this.addCharacteristic(Characteristic.RelayEnabled);
  }
}
// noinspection JSDeprecatedSymbols
Service.Relay = CloudRelay;
Service.CloudRelay = CloudRelay;

/**
 * Service "Contact Sensor"
 */
export class ContactSensor extends Service {

  public static readonly UUID: string = "00000080-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, ContactSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ContactSensorState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.ContactSensor = ContactSensor;

/**
 * Service "Data Stream Transport Management"
 */
export class DataStreamTransportManagement extends Service {

  public static readonly UUID: string = "00000129-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, DataStreamTransportManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SetupDataStreamTransport);
    this.addCharacteristic(Characteristic.SupportedDataStreamTransportConfiguration);
    this.addCharacteristic(Characteristic.Version);
  }
}
Service.DataStreamTransportManagement = DataStreamTransportManagement;

/**
 * Service "Diagnostics"
 */
export class Diagnostics extends Service {

  public static readonly UUID: string = "00000237-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Diagnostics.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SupportedDiagnosticsSnapshot);
  }
}
Service.Diagnostics = Diagnostics;

/**
 * Service "Door"
 */
export class Door extends Service {

  public static readonly UUID: string = "00000081-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Door.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentPosition);
    this.addCharacteristic(Characteristic.PositionState);
    this.addCharacteristic(Characteristic.TargetPosition);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.ObstructionDetected);
    this.addOptionalCharacteristic(Characteristic.HoldPosition);
  }
}
Service.Door = Door;

/**
 * Service "Doorbell"
 */
export class Doorbell extends Service {

  public static readonly UUID: string = "00000121-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Doorbell.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ProgrammableSwitchEvent);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Brightness);
    this.addOptionalCharacteristic(Characteristic.Mute);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.OperatingStateResponse);
    this.addOptionalCharacteristic(Characteristic.Volume);
  }
}
Service.Doorbell = Doorbell;

/**
 * Service "Fan"
 */
export class Fan extends Service {

  public static readonly UUID: string = "00000040-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Fan.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.On);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RotationDirection);
    this.addOptionalCharacteristic(Characteristic.RotationSpeed);
  }
}
Service.Fan = Fan;

/**
 * Service "Fanv2"
 */
export class Fanv2 extends Service {

  public static readonly UUID: string = "000000B7-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Fanv2.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CurrentFanState);
    this.addOptionalCharacteristic(Characteristic.TargetFanState);
    this.addOptionalCharacteristic(Characteristic.LockPhysicalControls);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RotationDirection);
    this.addOptionalCharacteristic(Characteristic.RotationSpeed);
    this.addOptionalCharacteristic(Characteristic.SwingMode);
  }
}
Service.Fanv2 = Fanv2;

/**
 * Service "Faucet"
 */
export class Faucet extends Service {

  public static readonly UUID: string = "000000D7-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Faucet.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
  }
}
Service.Faucet = Faucet;

/**
 * Service "Filter Maintenance"
 */
export class FilterMaintenance extends Service {

  public static readonly UUID: string = "000000BA-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, FilterMaintenance.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.FilterChangeIndication);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.FilterLifeLevel);
    this.addOptionalCharacteristic(Characteristic.ResetFilterIndication);
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.FilterMaintenance = FilterMaintenance;

/**
 * Service "Garage Door Opener"
 */
export class GarageDoorOpener extends Service {

  public static readonly UUID: string = "00000041-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, GarageDoorOpener.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentDoorState);
    this.addCharacteristic(Characteristic.TargetDoorState);
    this.addCharacteristic(Characteristic.ObstructionDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.LockCurrentState);
    this.addOptionalCharacteristic(Characteristic.LockTargetState);
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.GarageDoorOpener = GarageDoorOpener;

/**
 * Service "Heater-Cooler"
 */
export class HeaterCooler extends Service {

  public static readonly UUID: string = "000000BC-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, HeaterCooler.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.CurrentHeaterCoolerState);
    this.addCharacteristic(Characteristic.TargetHeaterCoolerState);
    this.addCharacteristic(Characteristic.CurrentTemperature);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.LockPhysicalControls);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RotationSpeed);
    this.addOptionalCharacteristic(Characteristic.SwingMode);
    this.addOptionalCharacteristic(Characteristic.CoolingThresholdTemperature);
    this.addOptionalCharacteristic(Characteristic.HeatingThresholdTemperature);
    this.addOptionalCharacteristic(Characteristic.TemperatureDisplayUnits);
  }
}
Service.HeaterCooler = HeaterCooler;

/**
 * Service "Humidifier-Dehumidifier"
 */
export class HumidifierDehumidifier extends Service {

  public static readonly UUID: string = "000000BD-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, HumidifierDehumidifier.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.CurrentHumidifierDehumidifierState);
    this.addCharacteristic(Characteristic.TargetHumidifierDehumidifierState);
    this.addCharacteristic(Characteristic.CurrentRelativeHumidity);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.LockPhysicalControls);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold);
    this.addOptionalCharacteristic(Characteristic.RelativeHumidityHumidifierThreshold);
    this.addOptionalCharacteristic(Characteristic.RotationSpeed);
    this.addOptionalCharacteristic(Characteristic.SwingMode);
    this.addOptionalCharacteristic(Characteristic.WaterLevel);
  }
}
Service.HumidifierDehumidifier = HumidifierDehumidifier;

/**
 * Service "Humidity Sensor"
 */
export class HumiditySensor extends Service {

  public static readonly UUID: string = "00000082-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, HumiditySensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentRelativeHumidity);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.HumiditySensor = HumiditySensor;

/**
 * Service "Input Source"
 */
export class InputSource extends Service {

  public static readonly UUID: string = "000000D9-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, InputSource.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ConfiguredName);
    this.addCharacteristic(Characteristic.InputSourceType);
    this.addCharacteristic(Characteristic.IsConfigured);
    if (!this.testCharacteristic(Characteristic.Name)) { // workaround for Name characteristic collision in constructor
      this.addCharacteristic(Characteristic.Name).updateValue("Unnamed Service");
    }
    this.addCharacteristic(Characteristic.CurrentVisibilityState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Identifier);
    this.addOptionalCharacteristic(Characteristic.InputDeviceType);
    this.addOptionalCharacteristic(Characteristic.TargetVisibilityState);
  }
}
Service.InputSource = InputSource;

/**
 * Service "Irrigation-System"
 */
export class IrrigationSystem extends Service {

  public static readonly UUID: string = "000000CF-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, IrrigationSystem.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.ProgramMode);
    this.addCharacteristic(Characteristic.InUse);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.RemainingDuration);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
  }
}
Service.IrrigationSystem = IrrigationSystem;

/**
 * Service "Leak Sensor"
 */
export class LeakSensor extends Service {

  public static readonly UUID: string = "00000083-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, LeakSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.LeakDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.LeakSensor = LeakSensor;

/**
 * Service "Lightbulb"
 */
export class Lightbulb extends Service {

  public static readonly UUID: string = "00000043-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Lightbulb.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.On);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Brightness);
    this.addOptionalCharacteristic(Characteristic.CharacteristicValueActiveTransitionCount);
    this.addOptionalCharacteristic(Characteristic.CharacteristicValueTransitionControl);
    this.addOptionalCharacteristic(Characteristic.ColorTemperature);
    this.addOptionalCharacteristic(Characteristic.Hue);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.Saturation);
    this.addOptionalCharacteristic(Characteristic.SupportedCharacteristicValueTransitionConfiguration);
  }
}
Service.Lightbulb = Lightbulb;

/**
 * Service "Light Sensor"
 */
export class LightSensor extends Service {

  public static readonly UUID: string = "00000084-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, LightSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentAmbientLightLevel);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.LightSensor = LightSensor;

/**
 * Service "Lock Management"
 */
export class LockManagement extends Service {

  public static readonly UUID: string = "00000044-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, LockManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.LockControlPoint);
    this.addCharacteristic(Characteristic.Version);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.AdministratorOnlyAccess);
    this.addOptionalCharacteristic(Characteristic.AudioFeedback);
    this.addOptionalCharacteristic(Characteristic.CurrentDoorState);
    this.addOptionalCharacteristic(Characteristic.LockManagementAutoSecurityTimeout);
    this.addOptionalCharacteristic(Characteristic.LockLastKnownAction);
    this.addOptionalCharacteristic(Characteristic.Logs);
    this.addOptionalCharacteristic(Characteristic.MotionDetected);
  }
}
Service.LockManagement = LockManagement;

/**
 * Service "Lock Mechanism"
 */
export class LockMechanism extends Service {

  public static readonly UUID: string = "00000045-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, LockMechanism.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.LockCurrentState);
    this.addCharacteristic(Characteristic.LockTargetState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.LockMechanism = LockMechanism;

/**
 * Service "Microphone"
 */
export class Microphone extends Service {

  public static readonly UUID: string = "00000112-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Microphone.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Mute);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Volume);
  }
}
Service.Microphone = Microphone;

/**
 * Service "Motion Sensor"
 */
export class MotionSensor extends Service {

  public static readonly UUID: string = "00000085-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, MotionSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.MotionDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.MotionSensor = MotionSensor;

/**
 * Service "NFC Access"
 * @since iOS 15
 */
export class NFCAccess extends Service {

  public static readonly UUID: string = "00000266-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, NFCAccess.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ConfigurationState);
    this.addCharacteristic(Characteristic.NFCAccessControlPoint);
    this.addCharacteristic(Characteristic.NFCAccessSupportedConfiguration);
  }
}
Service.NFCAccess = NFCAccess;

/**
 * Service "Occupancy Sensor"
 */
export class OccupancySensor extends Service {

  public static readonly UUID: string = "00000086-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, OccupancySensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.OccupancyDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.OccupancySensor = OccupancySensor;

/**
 * Service "Outlet"
 * @since iOS 13
 */
export class Outlet extends Service {

  public static readonly UUID: string = "00000047-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Outlet.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.On);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.OutletInUse);
  }
}
Service.Outlet = Outlet;

/**
 * Service "Pairing"
 */
export class Pairing extends Service {

  public static readonly UUID: string = "00000055-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Pairing.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ListPairings);
    this.addCharacteristic(Characteristic.PairSetup);
    this.addCharacteristic(Characteristic.PairVerify);
    this.addCharacteristic(Characteristic.PairingFeatures);
  }
}
Service.Pairing = Pairing;

/**
 * Service "Power Management"
 */
export class PowerManagement extends Service {

  public static readonly UUID: string = "00000221-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, PowerManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.WakeConfiguration);
  }
}
Service.PowerManagement = PowerManagement;

/**
 * Service "Protocol Information"
 */
export class ProtocolInformation extends Service {

  public static readonly UUID: string = "000000A2-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, ProtocolInformation.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Version);
  }
}
Service.ProtocolInformation = ProtocolInformation;

/**
 * Service "Security System"
 */
export class SecuritySystem extends Service {

  public static readonly UUID: string = "0000007E-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, SecuritySystem.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SecuritySystemCurrentState);
    this.addCharacteristic(Characteristic.SecuritySystemTargetState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.SecuritySystemAlarmType);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.SecuritySystem = SecuritySystem;

/**
 * Service "Service Label"
 */
export class ServiceLabel extends Service {

  public static readonly UUID: string = "000000CC-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, ServiceLabel.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ServiceLabelNamespace);
  }
}
Service.ServiceLabel = ServiceLabel;

/**
 * Service "Siri"
 */
export class Siri extends Service {

  public static readonly UUID: string = "00000133-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Siri.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SiriInputType);
  }
}
Service.Siri = Siri;

/**
 * Service "Slats"
 */
export class Slats extends Service {

  public static readonly UUID: string = "000000B9-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Slats.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentSlatState);
    this.addCharacteristic(Characteristic.SlatType);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.SwingMode);
    this.addOptionalCharacteristic(Characteristic.CurrentTiltAngle);
    this.addOptionalCharacteristic(Characteristic.TargetTiltAngle);
  }
}
// noinspection JSDeprecatedSymbols
Service.Slat = Slats;
Service.Slats = Slats;

/**
 * Service "Smart Speaker"
 */
export class SmartSpeaker extends Service {

  public static readonly UUID: string = "00000228-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, SmartSpeaker.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentMediaState);
    this.addCharacteristic(Characteristic.TargetMediaState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.addOptionalCharacteristic(Characteristic.Mute);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.Volume);
  }
}
Service.SmartSpeaker = SmartSpeaker;

/**
 * Service "Smoke Sensor"
 */
export class SmokeSensor extends Service {

  public static readonly UUID: string = "00000087-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, SmokeSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SmokeDetected);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.SmokeSensor = SmokeSensor;

/**
 * Service "Speaker"
 * @since iOS 10
 */
export class Speaker extends Service {

  public static readonly UUID: string = "00000113-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Speaker.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Mute);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Active);
    this.addOptionalCharacteristic(Characteristic.Volume);
  }
}
Service.Speaker = Speaker;

/**
 * Service "Stateful Programmable Switch"
 */
export class StatefulProgrammableSwitch extends Service {

  public static readonly UUID: string = "00000088-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, StatefulProgrammableSwitch.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ProgrammableSwitchEvent);
    this.addCharacteristic(Characteristic.ProgrammableSwitchOutputState);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.StatefulProgrammableSwitch = StatefulProgrammableSwitch;

/**
 * Service "Stateless Programmable Switch"
 */
export class StatelessProgrammableSwitch extends Service {

  public static readonly UUID: string = "00000089-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, StatelessProgrammableSwitch.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ProgrammableSwitchEvent);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.ServiceLabelIndex);
  }
}
Service.StatelessProgrammableSwitch = StatelessProgrammableSwitch;

/**
 * Service "Switch"
 */
export class Switch extends Service {

  public static readonly UUID: string = "00000049-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Switch.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.On);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.Switch = Switch;

/**
 * Service "Target Control"
 */
export class TargetControl extends Service {

  public static readonly UUID: string = "00000125-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TargetControl.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.ActiveIdentifier);
    this.addCharacteristic(Characteristic.ButtonEvent);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
Service.TargetControl = TargetControl;

/**
 * Service "Target Control Management"
 */
export class TargetControlManagement extends Service {

  public static readonly UUID: string = "00000122-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TargetControlManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.TargetControlSupportedConfiguration);
    this.addCharacteristic(Characteristic.TargetControlList);
  }
}
Service.TargetControlManagement = TargetControlManagement;

/**
 * Service "Television"
 */
export class Television extends Service {

  public static readonly UUID: string = "000000D8-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Television.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.ActiveIdentifier);
    this.addCharacteristic(Characteristic.ConfiguredName);
    this.addCharacteristic(Characteristic.RemoteKey);
    this.addCharacteristic(Characteristic.SleepDiscoveryMode);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Brightness);
    this.addOptionalCharacteristic(Characteristic.ClosedCaptions);
    this.addOptionalCharacteristic(Characteristic.DisplayOrder);
    this.addOptionalCharacteristic(Characteristic.CurrentMediaState);
    this.addOptionalCharacteristic(Characteristic.TargetMediaState);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.PictureMode);
    this.addOptionalCharacteristic(Characteristic.PowerModeSelection);
  }
}
Service.Television = Television;

/**
 * Service "Television Speaker"
 */
export class TelevisionSpeaker extends Service {

  public static readonly UUID: string = "00000113-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TelevisionSpeaker.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Mute);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Active);
    this.addOptionalCharacteristic(Characteristic.Volume);
    this.addOptionalCharacteristic(Characteristic.VolumeControlType);
    this.addOptionalCharacteristic(Characteristic.VolumeSelector);
  }
}
Service.TelevisionSpeaker = TelevisionSpeaker;

/**
 * Service "Temperature Sensor"
 */
export class TemperatureSensor extends Service {

  public static readonly UUID: string = "0000008A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TemperatureSensor.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentTemperature);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.StatusActive);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.StatusLowBattery);
    this.addOptionalCharacteristic(Characteristic.StatusTampered);
  }
}
Service.TemperatureSensor = TemperatureSensor;

/**
 * Service "Thermostat"
 */
export class Thermostat extends Service {

  public static readonly UUID: string = "0000004A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Thermostat.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentHeatingCoolingState);
    this.addCharacteristic(Characteristic.TargetHeatingCoolingState);
    this.addCharacteristic(Characteristic.CurrentTemperature);
    this.addCharacteristic(Characteristic.TargetTemperature);
    this.addCharacteristic(Characteristic.TemperatureDisplayUnits);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.CurrentRelativeHumidity);
    this.addOptionalCharacteristic(Characteristic.TargetRelativeHumidity);
    this.addOptionalCharacteristic(Characteristic.CoolingThresholdTemperature);
    this.addOptionalCharacteristic(Characteristic.HeatingThresholdTemperature);
  }
}
Service.Thermostat = Thermostat;

/**
 * Service "Thread Transport"
 */
export class ThreadTransport extends Service {

  public static readonly UUID: string = "00000701-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, ThreadTransport.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentTransport);
    this.addCharacteristic(Characteristic.ThreadControlPoint);
    this.addCharacteristic(Characteristic.ThreadNodeCapabilities);
    this.addCharacteristic(Characteristic.ThreadStatus);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CCAEnergyDetectThreshold);
    this.addOptionalCharacteristic(Characteristic.CCASignalDetectThreshold);
    this.addOptionalCharacteristic(Characteristic.EventRetransmissionMaximum);
    this.addOptionalCharacteristic(Characteristic.EventTransmissionCounters);
    this.addOptionalCharacteristic(Characteristic.MACRetransmissionMaximum);
    this.addOptionalCharacteristic(Characteristic.MACTransmissionCounters);
    this.addOptionalCharacteristic(Characteristic.ReceiverSensitivity);
    this.addOptionalCharacteristic(Characteristic.ReceivedSignalStrengthIndication);
    this.addOptionalCharacteristic(Characteristic.SignalToNoiseRatio);
    this.addOptionalCharacteristic(Characteristic.ThreadOpenThreadVersion);
    this.addOptionalCharacteristic(Characteristic.TransmitPower);
    this.addOptionalCharacteristic(Characteristic.MaximumTransmitPower);
  }
}
Service.ThreadTransport = ThreadTransport;

/**
 * Service "Time Information"
 * @deprecated Removed and not used anymore
 */
export class TimeInformation extends Service {

  public static readonly UUID: string = "00000099-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TimeInformation.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentTime);
    this.addCharacteristic(Characteristic.DayoftheWeek);
    this.addCharacteristic(Characteristic.TimeUpdate);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
  }
}
// noinspection JSDeprecatedSymbols
Service.TimeInformation = TimeInformation;

/**
 * Service "Transfer Transport Management"
 */
export class TransferTransportManagement extends Service {

  public static readonly UUID: string = "00000203-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, TransferTransportManagement.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.SupportedTransferTransportConfiguration);
    this.addCharacteristic(Characteristic.SetupTransferTransport);
  }
}
Service.TransferTransportManagement = TransferTransportManagement;

/**
 * Service "Tunnel"
 */
export class Tunnel extends Service {

  public static readonly UUID: string = "00000056-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Tunnel.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.AccessoryIdentifier);
    this.addCharacteristic(Characteristic.TunnelConnectionTimeout);
    this.addCharacteristic(Characteristic.TunneledAccessoryAdvertising);
    this.addCharacteristic(Characteristic.TunneledAccessoryConnected);
    this.addCharacteristic(Characteristic.TunneledAccessoryStateNumber);
  }
}
// noinspection JSDeprecatedSymbols
Service.TunneledBTLEAccessoryService = Tunnel;
Service.Tunnel = Tunnel;

/**
 * Service "Valve"
 */
export class Valve extends Service {

  public static readonly UUID: string = "000000D0-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Valve.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.InUse);
    this.addCharacteristic(Characteristic.ValveType);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.IsConfigured);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.RemainingDuration);
    this.addOptionalCharacteristic(Characteristic.ServiceLabelIndex);
    this.addOptionalCharacteristic(Characteristic.SetDuration);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
  }
}
Service.Valve = Valve;

/**
 * Service "Wi-Fi Router"
 */
export class WiFiRouter extends Service {

  public static readonly UUID: string = "0000020A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, WiFiRouter.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.ConfiguredName);
    this.addCharacteristic(Characteristic.ManagedNetworkEnable);
    this.addCharacteristic(Characteristic.NetworkAccessViolationControl);
    this.addCharacteristic(Characteristic.NetworkClientProfileControl);
    this.addCharacteristic(Characteristic.NetworkClientStatusControl);
    this.addCharacteristic(Characteristic.RouterStatus);
    this.addCharacteristic(Characteristic.SupportedRouterConfiguration);
    this.addCharacteristic(Characteristic.WANConfigurationList);
    this.addCharacteristic(Characteristic.WANStatusList);
  }
}
Service.WiFiRouter = WiFiRouter;

/**
 * Service "Wi-Fi Satellite"
 */
export class WiFiSatellite extends Service {

  public static readonly UUID: string = "0000020F-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, WiFiSatellite.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.WiFiSatelliteStatus);
  }
}
Service.WiFiSatellite = WiFiSatellite;

/**
 * Service "Wi-Fi Transport"
 */
export class WiFiTransport extends Service {

  public static readonly UUID: string = "0000022A-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, WiFiTransport.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentTransport);
    this.addCharacteristic(Characteristic.WiFiCapabilities);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.WiFiConfigurationControl);
  }
}
Service.WiFiTransport = WiFiTransport;

/**
 * Service "Window"
 */
export class Window extends Service {

  public static readonly UUID: string = "0000008B-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, Window.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentPosition);
    this.addCharacteristic(Characteristic.PositionState);
    this.addCharacteristic(Characteristic.TargetPosition);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.ObstructionDetected);
    this.addOptionalCharacteristic(Characteristic.HoldPosition);
  }
}
Service.Window = Window;

/**
 * Service "Window Covering"
 */
export class WindowCovering extends Service {

  public static readonly UUID: string = "0000008C-0000-1000-8000-0026BB765291";

  constructor(displayName?: string, subtype?: string) {
    super(displayName, WindowCovering.UUID, subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.CurrentPosition);
    this.addCharacteristic(Characteristic.PositionState);
    this.addCharacteristic(Characteristic.TargetPosition);

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.CurrentHorizontalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.TargetHorizontalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.Name);
    this.addOptionalCharacteristic(Characteristic.ObstructionDetected);
    this.addOptionalCharacteristic(Characteristic.HoldPosition);
    this.addOptionalCharacteristic(Characteristic.CurrentVerticalTiltAngle);
    this.addOptionalCharacteristic(Characteristic.TargetVerticalTiltAngle);
  }
}
Service.WindowCovering = WindowCovering;

