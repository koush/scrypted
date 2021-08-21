import assert from "assert";
import createDebug from "debug";
import { EventEmitter } from "events";
import { ServiceJsonObject } from "../internal-types";
import { CharacteristicValue, Nullable, WithUUID } from '../types';
import { CharacteristicWarning, CharacteristicWarningType } from "./Accessory";
import {
  Characteristic,
  CharacteristicChange,
  CharacteristicEventTypes,
  SerializedCharacteristic
} from './Characteristic';
import {
  AccessCode,
  AccessControl,
  AccessoryInformation,
  AccessoryRuntimeInformation,
  AirPurifier,
  AirQualitySensor,
  AudioStreamManagement,
  Battery,
  BridgeConfiguration,
  BridgingState,
  CameraControl,
  CameraOperatingMode,
  CameraRecordingManagement,
  CameraRTPStreamManagement,
  CarbonDioxideSensor,
  CarbonMonoxideSensor,
  CloudRelay,
  ContactSensor,
  DataStreamTransportManagement,
  Diagnostics,
  Door,
  Doorbell,
  Fan,
  Fanv2,
  Faucet,
  FilterMaintenance,
  GarageDoorOpener,
  HeaterCooler,
  HumidifierDehumidifier,
  HumiditySensor,
  InputSource,
  IrrigationSystem,
  LeakSensor,
  Lightbulb,
  LightSensor,
  LockManagement,
  LockMechanism,
  Microphone,
  MotionSensor,
  NFCAccess,
  OccupancySensor,
  Outlet,
  Pairing,
  PowerManagement,
  ProtocolInformation,
  SecuritySystem,
  ServiceLabel,
  Siri,
  Slats,
  SmartSpeaker,
  SmokeSensor,
  Speaker,
  StatefulProgrammableSwitch,
  StatelessProgrammableSwitch,
  Switch,
  TargetControl,
  TargetControlManagement,
  Television,
  TelevisionSpeaker,
  TemperatureSensor,
  Thermostat,
  ThreadTransport,
  TimeInformation,
  TransferTransportManagement,
  Tunnel,
  Valve,
  WiFiRouter,
  WiFiSatellite,
  WiFiTransport,
  Window,
  WindowCovering,
} from "./definitions";
import { IdentifierCache } from './model/IdentifierCache';
import { HAPConnection } from "./util/eventedhttp";
import { toShortForm } from './util/uuid';


const debug = createDebug("HAP-NodeJS:Service");

/**
 * HAP spec allows a maximum of 100 characteristics per service!
 */
const MAX_CHARACTERISTICS = 100;

/**
 * @private
 */
export interface SerializedService {
  displayName: string,
  UUID: string,
  subtype?: string,
  constructorName?: string,

  hiddenService?: boolean,
  primaryService?: boolean,

  characteristics: SerializedCharacteristic[],
  optionalCharacteristics?: SerializedCharacteristic[],
}

export type ServiceId = string; // string with the format: UUID + (subtype | "")

export type ServiceCharacteristicChange = CharacteristicChange & { characteristic: Characteristic };

// noinspection JSUnusedGlobalSymbols
/**
 * @deprecated Use ServiceEventTypes instead
 */
export type EventService = ServiceEventTypes.CHARACTERISTIC_CHANGE | ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE;

export const enum ServiceEventTypes {
  CHARACTERISTIC_CHANGE = "characteristic-change",
  SERVICE_CONFIGURATION_CHANGE = "service-configurationChange",
  CHARACTERISTIC_WARNING = "characteristic-warning",
}

export declare interface Service {
  on(event: "characteristic-change", listener: (change: ServiceCharacteristicChange) => void): this;
  on(event: "service-configurationChange", listener: () => void): this;
  on(event: "characteristic-warning", listener: (warning: CharacteristicWarning) => void): this;

  emit(event: "characteristic-change", change: ServiceCharacteristicChange): boolean;
  emit(event: "service-configurationChange"): boolean;
  emit(event: "characteristic-warning", warning: CharacteristicWarning): boolean;
}

/**
 * Service represents a set of grouped values necessary to provide a logical function. For instance, a
 * "Door Lock Mechanism" service might contain two values, one for the "desired lock state" and one for the
 * "current lock state". A particular Service is distinguished from others by its "type", which is a UUID.
 * HomeKit provides a set of known Service UUIDs defined in HomeKit.ts along with a corresponding
 * concrete subclass that you can instantiate directly to setup the necessary values. These natively-supported
 * Services are expected to contain a particular set of Characteristics.
 *
 * Unlike Characteristics, where you cannot have two Characteristics with the same UUID in the same Service,
 * you can actually have multiple Services with the same UUID in a single Accessory. For instance, imagine
 * a Garage Door Opener with both a "security light" and a "backlight" for the display. Each light could be
 * a "Lightbulb" Service with the same UUID. To account for this situation, we define an extra "subtype"
 * property on Service, that can be a string or other string-convertible object that uniquely identifies the
 * Service among its peers in an Accessory. For instance, you might have `service1.subtype = 'security_light'`
 * for one and `service2.subtype = 'backlight'` for the other.
 *
 * You can also define custom Services by providing your own UUID for the type that you generate yourself.
 * Custom Services can contain an arbitrary set of Characteristics, but Siri will likely not be able to
 * work with these.
 */
export class Service extends EventEmitter {
  // Service MUST NOT have any other static variables

  // Pattern below is for automatic detection of the section of defined services. Used by the generator
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  public static AccessCode: typeof AccessCode;
  public static AccessControl: typeof AccessControl;
  public static AccessoryInformation: typeof AccessoryInformation;
  public static AccessoryRuntimeInformation: typeof AccessoryRuntimeInformation;
  public static AirPurifier: typeof AirPurifier;
  public static AirQualitySensor: typeof AirQualitySensor;
  public static AudioStreamManagement: typeof AudioStreamManagement;
  public static Battery: typeof Battery;
  /**
   * @deprecated Please use {@link Service.Battery}.
   */
  public static BatteryService: typeof Battery;
  /**
   * @deprecated Removed and not used anymore
   */
  public static BridgeConfiguration: typeof BridgeConfiguration;
  /**
   * @deprecated Removed and not used anymore
   */
  public static BridgingState: typeof BridgingState;
  /**
   * @deprecated This service has no usage anymore and will be ignored by iOS
   */
  public static CameraControl: typeof CameraControl;
  /**
   * @deprecated Please use {@link Service.CameraRecordingManagement}.
   */
  public static CameraEventRecordingManagement: typeof CameraRecordingManagement;
  public static CameraOperatingMode: typeof CameraOperatingMode;
  public static CameraRecordingManagement: typeof CameraRecordingManagement;
  public static CameraRTPStreamManagement: typeof CameraRTPStreamManagement;
  public static CarbonDioxideSensor: typeof CarbonDioxideSensor;
  public static CarbonMonoxideSensor: typeof CarbonMonoxideSensor;
  public static CloudRelay: typeof CloudRelay;
  public static ContactSensor: typeof ContactSensor;
  public static DataStreamTransportManagement: typeof DataStreamTransportManagement;
  public static Diagnostics: typeof Diagnostics;
  public static Door: typeof Door;
  public static Doorbell: typeof Doorbell;
  public static Fan: typeof Fan;
  public static Fanv2: typeof Fanv2;
  public static Faucet: typeof Faucet;
  public static FilterMaintenance: typeof FilterMaintenance;
  public static GarageDoorOpener: typeof GarageDoorOpener;
  public static HeaterCooler: typeof HeaterCooler;
  public static HumidifierDehumidifier: typeof HumidifierDehumidifier;
  public static HumiditySensor: typeof HumiditySensor;
  public static InputSource: typeof InputSource;
  public static IrrigationSystem: typeof IrrigationSystem;
  public static LeakSensor: typeof LeakSensor;
  public static Lightbulb: typeof Lightbulb;
  public static LightSensor: typeof LightSensor;
  public static LockManagement: typeof LockManagement;
  public static LockMechanism: typeof LockMechanism;
  public static Microphone: typeof Microphone;
  public static MotionSensor: typeof MotionSensor;
  public static NFCAccess: typeof NFCAccess;
  public static OccupancySensor: typeof OccupancySensor;
  public static Outlet: typeof Outlet;
  public static Pairing: typeof Pairing;
  public static PowerManagement: typeof PowerManagement;
  public static ProtocolInformation: typeof ProtocolInformation;
  /**
   * @deprecated Please use {@link Service.CloudRelay}.
   */
  public static Relay: typeof CloudRelay;
  public static SecuritySystem: typeof SecuritySystem;
  public static ServiceLabel: typeof ServiceLabel;
  public static Siri: typeof Siri;
  /**
   * @deprecated Please use {@link Service.Slats}.
   */
  public static Slat: typeof Slats;
  public static Slats: typeof Slats;
  public static SmartSpeaker: typeof SmartSpeaker;
  public static SmokeSensor: typeof SmokeSensor;
  public static Speaker: typeof Speaker;
  public static StatefulProgrammableSwitch: typeof StatefulProgrammableSwitch;
  public static StatelessProgrammableSwitch: typeof StatelessProgrammableSwitch;
  public static Switch: typeof Switch;
  public static TargetControl: typeof TargetControl;
  public static TargetControlManagement: typeof TargetControlManagement;
  public static Television: typeof Television;
  public static TelevisionSpeaker: typeof TelevisionSpeaker;
  public static TemperatureSensor: typeof TemperatureSensor;
  public static Thermostat: typeof Thermostat;
  public static ThreadTransport: typeof ThreadTransport;
  /**
   * @deprecated Removed and not used anymore
   */
  public static TimeInformation: typeof TimeInformation;
  public static TransferTransportManagement: typeof TransferTransportManagement;
  public static Tunnel: typeof Tunnel;
  /**
   * @deprecated Please use {@link Service.Tunnel}.
   */
  public static TunneledBTLEAccessoryService: typeof Tunnel;
  public static Valve: typeof Valve;
  public static WiFiRouter: typeof WiFiRouter;
  public static WiFiSatellite: typeof WiFiSatellite;
  public static WiFiTransport: typeof WiFiTransport;
  public static Window: typeof Window;
  public static WindowCovering: typeof WindowCovering;
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  // NOTICE: when adding/changing properties, remember to possibly adjust the serialize/deserialize functions
  public displayName: string;
  public UUID: string;
  subtype?: string;
  iid: Nullable<number> = null; // assigned later by our containing Accessory
  name: Nullable<string> = null;
  characteristics: Characteristic[] = [];
  optionalCharacteristics: Characteristic[] = [];
  /**
   * @private
   */
  isHiddenService: boolean = false;
  /**
   * @private
   */
  isPrimaryService: boolean = false; // do not write to this directly
  /**
   * @private
   */
  linkedServices: Service[] = [];

  public constructor(displayName: string = "", UUID: string, subtype?: string) {
    super();
    assert(UUID, "Services must be created with a valid UUID.");
    this.displayName = displayName;
    this.UUID = UUID;
    this.subtype = subtype;

    // every service has an optional Characteristic.Name property - we'll set it to our displayName
    // if one was given
    // if you don't provide a display name, some HomeKit apps may choose to hide the device.
    if (displayName) {
      // create the characteristic if necessary
      const nameCharacteristic =
        this.getCharacteristic(Characteristic.Name) ||
        this.addCharacteristic(Characteristic.Name);

      nameCharacteristic.updateValue(displayName);
    }
  }

  /**
   * Returns an id which uniquely identifies an service on the associated accessory.
   * The serviceId is a concatenation of the UUID for the service (defined by HAP) and the subtype (could be empty)
   * which is programmatically defined by the programmer.
   *
   * @returns the serviceId
   */
  public getServiceId(): ServiceId {
    return this.UUID + (this.subtype || "");
  }

  public addCharacteristic(input: Characteristic): Characteristic
  public addCharacteristic(input: { new (...args: any[]): Characteristic }, ...constructorArgs: any[]): Characteristic
  public addCharacteristic(input: Characteristic | {new (...args: any[]): Characteristic}, ...constructorArgs: any[]): Characteristic {
    // characteristic might be a constructor like `Characteristic.Brightness` instead of an instance of Characteristic. Coerce if necessary.

    let characteristic = typeof input === "function"? new input(...constructorArgs): input;

    // check for UUID conflict
    for (const existing of this.characteristics) {
      if (existing.UUID === characteristic.UUID) {
        if (characteristic.UUID === '00000052-0000-1000-8000-0026BB765291') {
          //This is a special workaround for the Firmware Revision characteristic.
          return existing;
        }
        throw new Error("Cannot add a Characteristic with the same UUID as another Characteristic in this Service: " + existing.UUID);
      }
    }

    if (this.characteristics.length >= MAX_CHARACTERISTICS) {
      throw new Error("Cannot add more than " + MAX_CHARACTERISTICS + " characteristics to a single service!");
    }

    this.setupCharacteristicEventHandlers(characteristic);

    this.characteristics.push(characteristic);

    this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);

    return characteristic;
  }

  /**
   * Sets this service as the new primary service.
   * Any currently active primary service will be reset to be not primary.
   * This will happen immediately, if the service was already added to an accessory, or later
   * when the service gets added to an accessory.
   *
   * @param isPrimary {boolean} - optional boolean (default true) if the service should be the primary service
   */
  public setPrimaryService(isPrimary: boolean = true): void {
    this.isPrimaryService = isPrimary;
    this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);
  }

  /**
   * Marks the service as hidden
   *
   * @param isHidden {boolean} - optional boolean (default true) if the service should be marked hidden
   */
  public setHiddenService(isHidden: boolean = true): void {
    this.isHiddenService = isHidden;
    this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);
  }

  /**
   * Adds a new link to the specified service. The service MUST be already added to
   * the SAME accessory.
   *
   * @param service - The service this service should link to
   */
  public addLinkedService(service: Service): void {
    //TODO: Add a check if the service is on the same accessory.
    if (!this.linkedServices.includes(service)) {
      this.linkedServices.push(service);
    }
    this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);
  }

  /**
   * Removes a link to the specified service which was previously added with {@link addLinkedService}
   *
   * @param service - Previously linked service
   */
  public removeLinkedService(service: Service): void {
    //TODO: Add a check if the service is on the same accessory.
    const index = this.linkedServices.indexOf(service);
    if (index !== -1) {
      this.linkedServices.splice(index, 1);
    }
    this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);
  }

  public removeCharacteristic(characteristic: Characteristic): void {
    const index = this.characteristics.indexOf(characteristic);
    if (index !== -1) {
      this.characteristics.splice(index, 1);
      characteristic.removeAllListeners();

      this.emit(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE);
    }
  }

  // If a Characteristic constructor is passed a Characteristic object will always be returned
  public getCharacteristic(constructor: WithUUID<{new (): Characteristic}>): Characteristic
  // Still support using a Characteristic constructor or a name so "passing though" a value still works
  // https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html#use-union-types
  public getCharacteristic(name: string | WithUUID<{new (): Characteristic}>): Characteristic | undefined
  public getCharacteristic(name: string | WithUUID<{new (): Characteristic}>) {
    // returns a characteristic object from the service
    // If  Service.prototype.getCharacteristic(Characteristic.Type)  does not find the characteristic,
    // but the type is in optionalCharacteristics, it adds the characteristic.type to the service and returns it.

    let index, characteristic: Characteristic;
    for (const characteristic of this.characteristics) {
      if (typeof name === 'string' && characteristic.displayName === name) {
        return characteristic;
      } else if (typeof name === 'function' && ((characteristic instanceof name) || (name.UUID === characteristic.UUID))) {
        return characteristic;
      }
    }
    if (typeof name === 'function') {
      for (const characteristic of this.optionalCharacteristics) {
        if ((characteristic instanceof name) || (name.UUID === characteristic.UUID)) {
          return this.addCharacteristic(name);
        }
      }

      const instance = this.addCharacteristic(name);
      // Not found in optional Characteristics. Adding anyway, but warning about it if it isn't the Name.
      if (name.UUID !== Characteristic.Name.UUID) {
        this.emitCharacteristicWarningEvent(instance, CharacteristicWarningType.WARN_MESSAGE,
          "Characteristic not in required or optional characteristic section for service " + this.constructor.name + ". Adding anyway.");
      }

      return instance;
    }
  }

  public testCharacteristic<T extends WithUUID<typeof Characteristic>>(name: string | T): boolean {
    // checks for the existence of a characteristic object in the service
    for (const characteristic of this.characteristics) {
      if (typeof name === 'string' && characteristic.displayName === name) {
        return true;
      } else if (typeof name === 'function' && ((characteristic instanceof name) || (name.UUID === characteristic.UUID))) {
        return true;
      }
    }
    return false;
  }

  public setCharacteristic<T extends WithUUID<{new (): Characteristic}>>(name: string | T, value: CharacteristicValue): Service {
    this.getCharacteristic(name)!.setValue(value);
    return this; // for chaining
  }

  // A function to only updating the remote value, but not firing the 'set' event.
  public updateCharacteristic<T extends WithUUID<{new (): Characteristic}>>(name: string | T, value: CharacteristicValue): Service {
    this.getCharacteristic(name)!.updateValue(value);
    return this;
  }

  public addOptionalCharacteristic(characteristic: Characteristic | {new (): Characteristic}): void {
    // characteristic might be a constructor like `Characteristic.Brightness` instead of an instance
    // of Characteristic. Coerce if necessary.
    if (typeof characteristic === 'function') {
      // @ts-ignore we are dealing with predefined characteristics here
      characteristic = new characteristic() as Characteristic;
    }

    this.optionalCharacteristics.push(characteristic);
  }

  // noinspection JSUnusedGlobalSymbols
  /**
   * This method was created to copy all characteristics from another service to this.
   * It's only adopting is currently in homebridge to merge the AccessoryInformation service. So some things
   * my be explicitly tailored towards this use case.
   *
   * It will not remove characteristics which are present currently but not added on the other characteristic.
   * It will not replace the characteristic if the value is falsy (except of '0' or 'false')
   * @param service
   * @private used by homebridge
   */
  replaceCharacteristicsFromService(service: Service): void {
    if (this.UUID !== service.UUID) {
      throw new Error(`Incompatible services. Tried replacing characteristics of ${this.UUID} with characteristics from ${service.UUID}`);
    }

    const foreignCharacteristics: Record<string, Characteristic> = {}; // index foreign characteristics by UUID
    service.characteristics.forEach(characteristic => foreignCharacteristics[characteristic.UUID] = characteristic);

    this.characteristics.forEach(characteristic => {
      const foreignCharacteristic = foreignCharacteristics[characteristic.UUID];
      if (foreignCharacteristic) {
        delete foreignCharacteristics[characteristic.UUID];

        if (!foreignCharacteristic.value && foreignCharacteristic.value !== 0 && foreignCharacteristic.value !== false) {
          return; // ignore falsy values except if its the number zero or literally false
        }

        characteristic.replaceBy(foreignCharacteristic);
      }
    });

    // add all additional characteristics which where not present already
    Object.values(foreignCharacteristics).forEach(characteristic => this.addCharacteristic(characteristic));
  }

  /**
   * @private
   */
  getCharacteristicByIID(iid: number): Characteristic | undefined {
    for (const characteristic of this.characteristics) {
      if (characteristic.iid === iid)
        return characteristic;
    }
  }

  /**
   * @private
   */
  _assignIDs(identifierCache: IdentifierCache, accessoryName: string, baseIID: number = 0): void {
    // the Accessory Information service must have a (reserved by IdentifierCache) ID of 1
    if (this.UUID === '0000003E-0000-1000-8000-0026BB765291') {
      this.iid = 1;
    } else {
      // assign our own ID based on our UUID
      this.iid = baseIID + identifierCache.getIID(accessoryName, this.UUID, this.subtype);
    }

    // assign IIDs to our Characteristics
    for (const characteristic of this.characteristics) {
      characteristic._assignID(identifierCache, accessoryName, this.UUID, this.subtype);
    }
  }

  /**
   * Returns a JSON representation of this service suitable for delivering to HAP clients.
   * @private used to generate response to /accessories query
   */
  toHAP(connection: HAPConnection, contactGetHandlers = true): Promise<ServiceJsonObject> {
    return new Promise(resolve => {
      assert(this.iid, "iid cannot be undefined for service '" + this.displayName + "'");
      assert(this.characteristics.length, "service '" + this.displayName + "' does not have any characteristics!");

      const service: ServiceJsonObject = {
        type: toShortForm(this.UUID),
        iid: this.iid!,
        characteristics: [],
        hidden: this.isHiddenService? true: undefined,
        primary: this.isPrimaryService? true: undefined,
      }

      if (this.linkedServices.length) {
        service.linked = [];
        for (const linked of this.linkedServices) {
          if (!linked.iid) {
            // we got a linked service which is not added to the accessory
            // as it doesn't "exists" we just ignore it.
            // we have some (at least one) plugins on homebridge which link to the AccessoryInformation service.
            // homebridge always creates it's own AccessoryInformation service and ignores the user supplied one
            // thus the link is automatically broken.
            debug(`iid of linked service '${linked.displayName}' ${linked.UUID} is undefined on service '${this.displayName}'`);
            continue;
          }
          service.linked.push(linked.iid!);
        }
      }

      const missingCharacteristics: Set<Characteristic> = new Set();
      let timeout: NodeJS.Timeout | undefined = setTimeout(() => {
        for (const characteristic of missingCharacteristics) {
          this.emitCharacteristicWarningEvent(characteristic, CharacteristicWarningType.SLOW_READ,
            `The read handler for the characteristic '${characteristic.displayName}' was slow to respond!`);
        }

        timeout = setTimeout(() => {
          timeout = undefined;

          for (const characteristic of missingCharacteristics) {
            this.emitCharacteristicWarningEvent(characteristic, CharacteristicWarningType.TIMEOUT_READ,
              "The read handler for the characteristic '" + characteristic?.displayName +
              "' didn't respond at all!. Please check that you properly call the callback!");
            service.characteristics.push(characteristic.internalHAPRepresentation()); // value is set to null
          }

          missingCharacteristics.clear();
          resolve(service);
        }, 6000);
      }, 3000);

      for (const characteristic of this.characteristics) {
        missingCharacteristics.add(characteristic);
        characteristic.toHAP(connection, contactGetHandlers).then(value => {
          if (!timeout) {
            return; // if timeout is undefined, response was already sent out
          }

          missingCharacteristics.delete(characteristic);
          service.characteristics.push(value);

          if (missingCharacteristics.size === 0) {
            if (timeout) {
              clearTimeout(timeout);
              timeout = undefined;
            }
            resolve(service);
          }
        });
      }
    });
  }

  /**
   * Returns a JSON representation of this service without characteristic values.
   * @private used to generate the config hash
   */
  internalHAPRepresentation(): ServiceJsonObject {
    assert(this.iid, "iid cannot be undefined for service '" + this.displayName + "'");
    assert(this.characteristics.length, "service '" + this.displayName + "' does not have any characteristics!");

    const service: ServiceJsonObject = {
      type: toShortForm(this.UUID),
      iid: this.iid!,
      characteristics: this.characteristics.map(characteristic => characteristic.internalHAPRepresentation()),
      hidden: this.isHiddenService? true: undefined,
      primary: this.isPrimaryService? true: undefined,
    }

    if (this.linkedServices.length) {
      service.linked = [];
      for (const linked of this.linkedServices) {
        if (!linked.iid) {
          // we got a linked service which is not added to the accessory
          // as it doesn't "exists" we just ignore it.
          // we have some (at least one) plugins on homebridge which link to the AccessoryInformation service.
          // homebridge always creates it's own AccessoryInformation service and ignores the user supplied one
          // thus the link is automatically broken.
          debug(`iid of linked service '${linked.displayName}' ${linked.UUID} is undefined on service '${this.displayName}'`);
          continue;
        }
        service.linked.push(linked.iid!);
      }
    }

    return service;
  }

  /**
   * @private
   */
  private setupCharacteristicEventHandlers(characteristic: Characteristic): void {
    // listen for changes in characteristics and bubble them up
    characteristic.on(CharacteristicEventTypes.CHANGE, (change: CharacteristicChange) => {
      this.emit(ServiceEventTypes.CHARACTERISTIC_CHANGE, { ...change, characteristic: characteristic });
    });

    characteristic.on(CharacteristicEventTypes.CHARACTERISTIC_WARNING, this.emitCharacteristicWarningEvent.bind(this, characteristic));
  }

  /**
   * @private
   */
  private emitCharacteristicWarningEvent(characteristic: Characteristic, type: CharacteristicWarningType, message: string, stack?: string): void {
    this.emit(ServiceEventTypes.CHARACTERISTIC_WARNING, {
      characteristic: characteristic,
      type: type,
      message: message,
      originatorChain: [this.displayName, characteristic.displayName],
      stack: stack,
    })
  }

  /**
   * @private
   */
  private _sideloadCharacteristics(targetCharacteristics: Characteristic[]): void {
    for (const target of targetCharacteristics) {
      this.setupCharacteristicEventHandlers(target);
    }

    this.characteristics = targetCharacteristics.slice();
  }

  /**
   * @private
   */
  static serialize(service: Service): SerializedService {
    let constructorName: string | undefined;
    if (service.constructor.name !== "Service") {
      constructorName = service.constructor.name;
    }

    return {
      displayName: service.displayName,
      UUID: service.UUID,
      subtype: service.subtype,

      constructorName: constructorName,

      hiddenService: service.isHiddenService,
      primaryService: service.isPrimaryService,

      characteristics: service.characteristics.map(characteristic => Characteristic.serialize(characteristic)),
      optionalCharacteristics: service.optionalCharacteristics.map(characteristic => Characteristic.serialize(characteristic)),
    };
  }

  /**
   * @private
   */
  static deserialize(json: SerializedService): Service {
    let service: Service;

    if (json.constructorName && json.constructorName.charAt(0).toUpperCase() === json.constructorName.charAt(0)
      && Service[json.constructorName as keyof (typeof Service)]) { // MUST start with uppercase character and must exist on Service object
      const constructor = Service[json.constructorName as keyof (typeof Service)] as { new(displayName?: string, subtype?: string): Service };
      service = new constructor(json.displayName, json.subtype);
    } else {
      service = new Service(json.displayName, json.UUID, json.subtype);
    }

    service.isHiddenService = !!json.hiddenService;
    service.isPrimaryService = !!json.primaryService;

    const characteristics = json.characteristics.map(serialized => Characteristic.deserialize(serialized));
    service._sideloadCharacteristics(characteristics);

    if (json.optionalCharacteristics) {
      service.optionalCharacteristics = json.optionalCharacteristics.map(serialized => Characteristic.deserialize(serialized));
    }

    return service;
  }

}
