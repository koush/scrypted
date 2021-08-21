import assert from "assert";
import { MulticastOptions } from "bonjour-hap";
import crypto from 'crypto';
import createDebug from 'debug';
import { EventEmitter } from "events";
import net from "net";
import {
  AccessoryJsonObject,
  CharacteristicId,
  CharacteristicReadData,
  CharacteristicsReadRequest,
  CharacteristicsReadResponse,
  CharacteristicsWriteRequest,
  CharacteristicsWriteResponse,
  CharacteristicWrite,
  CharacteristicWriteData,
  PartialCharacteristicReadData,
  PartialCharacteristicWriteData,
  ResourceRequest,
  ResourceRequestType
} from "../internal-types";
import {
  CharacteristicValue,
  HAPPincode,
  InterfaceName,
  IPAddress,
  MacAddress,
  Nullable,
  VoidCallback,
  WithUUID,
} from '../types';
import { Advertiser, AdvertiserEvent, BonjourHAPAdvertiser, CiaoAdvertiser } from './Advertiser';
// noinspection JSDeprecatedSymbols
import { LegacyCameraSource, LegacyCameraSourceAdapter, StreamController } from './camera';
import {
  Access,
  ChangeReason,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicOperationContext,
  CharacteristicSetCallback,
  Perms
} from './Characteristic';
import {
  CameraController,
  CameraControllerOptions,
  Controller,
  ControllerConstructor,
  ControllerIdentifier,
  ControllerServiceMap,
  isSerializableController,
} from "./controller";
import {
  AccessoriesCallback,
  AddPairingCallback,
  HAPHTTPCode,
  HAPServer,
  HAPServerEventTypes,
  HAPStatus,
  IdentifyCallback,
  ListPairingsCallback,
  PairCallback,
  ReadCharacteristicsCallback,
  RemovePairingCallback,
  ResourceRequestCallback,
  TLVErrorCode,
  WriteCharacteristicsCallback
} from './HAPServer';
import { AccessoryInfo, PermissionTypes } from './model/AccessoryInfo';
import { ControllerStorage } from "./model/ControllerStorage";
import { IdentifierCache } from './model/IdentifierCache';
import { SerializedService, Service, ServiceCharacteristicChange, ServiceEventTypes, ServiceId } from './Service';
import { clone } from './util/clone';
import { EventName, HAPConnection, HAPUsername } from "./util/eventedhttp";
import { formatOutgoingCharacteristicValue } from "./util/request-util";
import * as uuid from "./util/uuid";
import { toShortForm } from "./util/uuid";


const debug = createDebug('HAP-NodeJS:Accessory');
const MAX_ACCESSORIES = 149; // Maximum number of bridged accessories per bridge.
const MAX_SERVICES = 100;

// Known category values. Category is a hint to iOS clients about what "type" of Accessory this represents, for UI only.
export const enum Categories {
  // noinspection JSUnusedGlobalSymbols
  OTHER = 1,
  BRIDGE = 2,
  FAN = 3,
  GARAGE_DOOR_OPENER = 4,
  LIGHTBULB = 5,
  DOOR_LOCK = 6,
  OUTLET = 7,
  SWITCH = 8,
  THERMOSTAT = 9,
  SENSOR = 10,
  ALARM_SYSTEM = 11,
  SECURITY_SYSTEM = 11, //Added to conform to HAP naming
  DOOR = 12,
  WINDOW = 13,
  WINDOW_COVERING = 14,
  PROGRAMMABLE_SWITCH = 15,
  RANGE_EXTENDER = 16,
  CAMERA = 17,
  IP_CAMERA = 17, //Added to conform to HAP naming
  VIDEO_DOORBELL = 18,
  AIR_PURIFIER = 19,
  AIR_HEATER = 20,
  AIR_CONDITIONER = 21,
  AIR_HUMIDIFIER = 22,
  AIR_DEHUMIDIFIER = 23,
  APPLE_TV = 24,
  HOMEPOD = 25,
  SPEAKER = 26,
  AIRPORT = 27,
  SPRINKLER = 28,
  FAUCET = 29,
  SHOWER_HEAD = 30,
  TELEVISION = 31,
  TARGET_CONTROLLER = 32, // Remote Control
  ROUTER = 33,
  AUDIO_RECEIVER = 34,
  TV_SET_TOP_BOX = 35,
  TV_STREAMING_STICK = 36,
}

/**
 * @private
 */
export interface SerializedAccessory {
  displayName: string,
  UUID: string,
  lastKnownUsername?: MacAddress,
  category: Categories,

  services: SerializedService[],
  linkedServices?: Record<ServiceId, ServiceId[]>,
  controllers?: SerializedControllerContext[],
}

/**
 * @private
 */
export interface SerializedControllerContext {
  type: ControllerIdentifier, // this field is called type out of history
  services: SerializedServiceMap,
}

export type SerializedServiceMap = Record<string, ServiceId>; // maps controller defined name (from the ControllerServiceMap) to serviceId

export interface ControllerContext {
  controller: Controller
  serviceMap: ControllerServiceMap,
}

export const enum CharacteristicWarningType {
  SLOW_WRITE = "slow-write",
  TIMEOUT_WRITE = "timeout-write",
  SLOW_READ = "slow-read",
  TIMEOUT_READ = "timeout-read",
  WARN_MESSAGE = "warn-message",
  ERROR_MESSAGE = "error-message",
  DEBUG_MESSAGE = "debug-message",
}

export interface CharacteristicWarning {
  characteristic: Characteristic,
  type: CharacteristicWarningType,
  message: string,
  originatorChain: string[],
  stack?: string,
}

/**
 * @deprecated
 */
export type CharacteristicEvents = Record<string, any>;

export interface PublishInfo {
  username: MacAddress;
  pincode: HAPPincode;
  /**
   * Specify the category for the HomeKit accessory.
   * The category is used only in the mdns advertisement and specifies the devices type
   * for the HomeKit controller.
   * Currently this only affects the icon shown in the pairing screen.
   * For the Television and Smart Speaker service it also affects the icon shown in
   * the Home app when paired.
   */
  category?: Categories;
  setupID?: string;
  /**
   * Defines the host where the HAP server will be bound to.
   * When undefined the HAP server will bind to all available interfaces
   * (see https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback).
   *
   * This property accepts a mixture of IPAddresses and network interface names.
   * Depending on the mixture of supplied addresses/names hap-nodejs will bind differently.
   *
   * It is advised to not just bind to a specific address, but specifying the interface name
   * in oder to bind on all address records (and ip version) available.
   *
   * HAP-NodeJS (or the underlying ciao library) will not report about misspelled interface names,
   * as it could be that the interface is currently just down and will come up later.
   *
   * Here are a few examples:
   *  - bind: "::"
   *      Pretty much identical to not specifying anything, as most systems (with ipv6 support)
   *      will default to the unspecified ipv6 address (with dual stack support).
   *
   *  - bind: "0.0.0.0"
   *      Binding TCP socket to the unspecified ipv4 address.
   *      The mdns advertisement will exclude any ipv6 address records.
   *
   *  - bind: ["en0", "lo0"]
   *      The mdns advertising will advertise all records of the en0 and loopback interface (if available) and
   *      will also react to address changes on those interfaces.
   *      In order for the HAP server to accept all those address records (which may contain ipv6 records)
   *      it will bind on the unspecified ipv6 address "::" (assuming dual stack is supported).
   *
   *  - bind: ["en0", "lo0", "0.0.0.0"]
   *      Same as above, only that the HAP server will bind on the unspecified ipv4 address "0.0.0.0".
   *      The mdns advertisement will not advertise any ipv6 records.
   *
   *  - bind: "169.254.104.90"
   *      This will bind the HAP server to the address 0.0.0.0.
   *      The mdns advertisement will only advertise the A record 169.254.104.90.
   *      If the given network interface of that address encounters an ip address change (to a different address),
   *      the mdns advertisement will result in not advertising a address at all.
   *      So it is advised to specify a interface name instead of a specific address.
   *      This is identical with ipv6 addresses.
   *
   *  - bind: ["169.254.104.90", "192.168.1.4"]
   *      As the HAP TCP socket can only bind to a single address, when specifying multiple ip addresses
   *      the HAP server will bind to the unspecified ip address (0.0.0.0 if only ipv4 addresses are supplied,
   *      :: if a mixture or only ipv6 addresses are supplied).
   *      The mdns advertisement will only advertise the specified ip addresses.
   *      If the given network interface of that address encounters an ip address change (to different addresses),
   *      the mdns advertisement will result in not advertising a address at all.
   *      So it is advised to specify a interface name instead of a specific address.
   *
   */
  bind?: (InterfaceName | IPAddress) | (InterfaceName | IPAddress)[];
  /**
   * Defines the port where the HAP server will be bound to.
   * When undefined port 0 will be used resulting in a random port.
   */
  port?: number;
  /**
   * Used to define custom MDNS options. Is not used anymore.
   * @deprecated
   */
  mdns?: MulticastOptions;
  /**
   * If this option is set to true, HAP-NodeJS will add identifying material (based on {@link username})
   * to the end of the accessory display name (and bonjour instance name).
   * Default: true
   */
  addIdentifyingMaterial?: boolean;
  /**
   * Defines the advertiser used with the published Accessory.
   */
  advertiser?: MDNSAdvertiser;
  /**
   * Use the legacy bonjour-hap as advertiser.
   * @deprecated
   */
  useLegacyAdvertiser?: boolean;
}

export const enum MDNSAdvertiser {
  /**
   * Use the `@homebridge/ciao` module as advertiser.
   */
  CIAO = "ciao",
  /**
   * Use the `bonjour-hap` module as advertiser.
   */
  BONJOUR = "bonjour-hap",
}

export type AccessoryCharacteristicChange = ServiceCharacteristicChange &  {
  service: Service;
};

export interface ServiceConfigurationChange {
  service: Service;
}

const enum WriteRequestState {
  REGULAR_REQUEST,
  TIMED_WRITE_AUTHENTICATED,
  TIMED_WRITE_REJECTED
}

// noinspection JSUnusedGlobalSymbols
/**
 * @deprecated Use AccessoryEventTypes instead
 */
export type EventAccessory = "identify" | "listening" | "service-configurationChange" | "service-characteristic-change";

export const enum AccessoryEventTypes {
  /**
   * Emitted when an iOS device wishes for this Accessory to identify itself. If `paired` is false, then
   * this device is currently browsing for Accessories in the system-provided "Add Accessory" screen. If
   * `paired` is true, then this is a device that has already paired with us. Note that if `paired` is true,
   * listening for this event is a shortcut for the underlying mechanism of setting the `Identify` Characteristic:
   * `getService(Service.AccessoryInformation).getCharacteristic(Characteristic.Identify).on('set', ...)`
   * You must call the callback for identification to be successful.
   */
  IDENTIFY = "identify",
  LISTENING = "listening",
  SERVICE_CONFIGURATION_CHANGE = "service-configurationChange",
  /**
   * Emitted after a change in the value of one of the provided Service's Characteristics.
   */
  SERVICE_CHARACTERISTIC_CHANGE = "service-characteristic-change",
  PAIRED = "paired",
  UNPAIRED = "unpaired",

  CHARACTERISTIC_WARNING = "characteristic-warning",
}

export declare interface Accessory {
  on(event: "identify", listener: (paired: boolean, callback: VoidCallback) => void): this;
  on(event: "listening", listener: (port: number, address: string) => void): this;

  on(event: "service-configurationChange", listener: (change: ServiceConfigurationChange) => void): this;
  on(event: "service-characteristic-change", listener: (change: AccessoryCharacteristicChange) => void): this;

  on(event: "paired", listener: () => void): this;
  on(event: "unpaired", listener: () => void): this;

  on(event: "characteristic-warning", listener: (warning: CharacteristicWarning) => void): this;


  emit(event: "identify", paired: boolean, callback: VoidCallback): boolean;
  emit(event: "listening", port: number, address: string): boolean;

  emit(event: "service-configurationChange", change: ServiceConfigurationChange): boolean;
  emit(event: "service-characteristic-change", change: AccessoryCharacteristicChange): boolean;

  emit(event: "paired"): boolean;
  emit(event: "unpaired"): boolean;

  emit(event: "characteristic-warning", warning: CharacteristicWarning): boolean;
}

/**
 * Accessory is a virtual HomeKit device. It can publish an associated HAP server for iOS devices to communicate
 * with - or it can run behind another "Bridge" Accessory server.
 *
 * Bridged Accessories in this implementation must have a UUID that is unique among all other Accessories that
 * are hosted by the Bridge. This UUID must be "stable" and unchanging, even when the server is restarted. This
 * is required so that the Bridge can provide consistent "Accessory IDs" (aid) and "Instance IDs" (iid) for all
 * Accessories, Services, and Characteristics for iOS clients to reference later.
 */
export class Accessory extends EventEmitter {

  /**
   * @deprecated Please use the Categories const enum above. Scheduled to be removed in 2021-06.
   */
  // @ts-ignore
  static Categories = Categories;

  // NOTICE: when adding/changing properties, remember to possibly adjust the serialize/deserialize functions
  aid: Nullable<number> = null; // assigned by us in assignIDs() or by a Bridge
  _isBridge: boolean = false; // true if we are a Bridge (creating a new instance of the Bridge subclass sets this to true)
  bridged: boolean = false; // true if we are hosted "behind" a Bridge Accessory
  bridge?: Accessory; // if accessory is bridged, this property points to the bridge which bridges this accessory
  bridgedAccessories: Accessory[] = []; // If we are a Bridge, these are the Accessories we are bridging
  reachable: boolean = true;
  lastKnownUsername?: MacAddress;
  category: Categories = Categories.OTHER;
  services: Service[] = [];
  private primaryService?: Service;
  shouldPurgeUnusedIDs: boolean = true; // Purge unused ids by default

  private controllers: Record<ControllerIdentifier, ControllerContext> = {};
  private serializedControllers?: Record<ControllerIdentifier, ControllerServiceMap>; // store uninitialized controller data after a Accessory.deserialize call
  private activeCameraController?: CameraController;

  _accessoryInfo?: Nullable<AccessoryInfo>;
  _setupID: Nullable<string> = null;
  _identifierCache?: Nullable<IdentifierCache>;
  controllerStorage: ControllerStorage = new ControllerStorage(this);
  _advertiser?: Advertiser;
  _server?: HAPServer;
  _setupURI?: string;

  private configurationChangeDebounceTimeout?: NodeJS.Timeout;
  /**
   * This property captures the time when we last server a /accessories request.
   * For multiple bursts of /accessories request we don't want to always contact GET handlers
   */
  private lastAccessoriesRequest: number = 0;

  constructor(public displayName: string, public UUID: string) {
    super();
    assert(displayName, "Accessories must be created with a non-empty displayName.");
    assert(UUID, "Accessories must be created with a valid UUID.")
    assert(uuid.isValid(UUID), "UUID '" + UUID + "' is not a valid UUID. Try using the provided 'generateUUID' function to create a valid UUID from any arbitrary string, like a serial number.");

    // create our initial "Accessory Information" Service that all Accessories are expected to have
    this.addService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name, displayName);

    // sign up for when iOS attempts to "set" the Identify characteristic - this means a paired device wishes
    // for us to identify ourselves (as opposed to an unpaired device - that case is handled by HAPServer 'identify' event)
    this.getService(Service.AccessoryInformation)!
      .getCharacteristic(Characteristic.Identify)!
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          const paired = true;
          this.identificationRequest(paired, callback);
        }
      });
  }

  private identificationRequest(paired: boolean, callback: IdentifyCallback) {
    debug("[%s] Identification request", this.displayName);

    if (this.listeners(AccessoryEventTypes.IDENTIFY).length > 0) {
      // allow implementors to identify this Accessory in whatever way is appropriate, and pass along
      // the standard callback for completion.
      this.emit(AccessoryEventTypes.IDENTIFY, paired, callback);
    } else {
      debug("[%s] Identification request ignored; no listeners to 'identify' event", this.displayName);
      callback();
    }
  }

  public addService(serviceParam: Service | typeof Service, ...constructorArgs: any[]): Service {
    // service might be a constructor like `Service.AccessoryInformation` instead of an instance
    // of Service. Coerce if necessary.
    const service: Service = typeof serviceParam === 'function'
        ? new serviceParam(constructorArgs[0], constructorArgs[1], constructorArgs[2])
        : serviceParam;

    // check for UUID+subtype conflict
    for (const existing of this.services) {
      if (existing.UUID === service.UUID) {
        // OK we have two Services with the same UUID. Check that each defines a `subtype` property and that each is unique.
        if (!service.subtype)
          throw new Error("Cannot add a Service with the same UUID '" + existing.UUID + "' as another Service in this Accessory without also defining a unique 'subtype' property.");

        if (service.subtype === existing.subtype)
          throw new Error("Cannot add a Service with the same UUID '" + existing.UUID + "' and subtype '" + existing.subtype + "' as another Service in this Accessory.");
      }
    }

    if (this.services.length >= MAX_SERVICES) {
      throw new Error("Cannot add more than " + MAX_SERVICES + " services to a single accessory!");
    }

    this.services.push(service);

    if (service.isPrimaryService) { // check if a primary service was added
      if (this.primaryService !== undefined) {
        this.primaryService.isPrimaryService = false;
      }

      this.primaryService = service;
    }

    if (!this.bridged) {
      this.enqueueConfigurationUpdate();
    } else {
      this.emit(AccessoryEventTypes.SERVICE_CONFIGURATION_CHANGE, { service: service });
    }

    this.setupServiceEventHandlers(service);

    return service;
  }

  /**
   * @deprecated use {@link Service.setPrimaryService} directly
   */
  public setPrimaryService(service: Service): void {
    service.setPrimaryService();
  }

  public removeService(service: Service): void {
    const index = this.services.indexOf(service);

    if (index >= 0) {
      this.services.splice(index, 1);

      if (this.primaryService === service) { // check if we are removing out primary service
        this.primaryService = undefined;
      }
      this.removeLinkedService(service); // remove it from linked service entries on the local accessory

      if (!this.bridged) {
        this.enqueueConfigurationUpdate();
      } else {
        this.emit(AccessoryEventTypes.SERVICE_CONFIGURATION_CHANGE, { service: service });
      }

      service.removeAllListeners();
    }
  }

  private removeLinkedService(removed: Service) {
    for (const service of this.services) {
      service.removeLinkedService(removed);
    }
  }

  public getService<T extends WithUUID<typeof Service>>(name: string | T): Service | undefined {
    for (const service of this.services) {
      if (typeof name === 'string' && (service.displayName === name || service.name === name || service.subtype === name)) {
        return service;
      } else if (typeof name === 'function' && ((service instanceof name) || (name.UUID === service.UUID))) {
        return service;
      }
    }

    return undefined;
  }

  public getServiceById<T extends WithUUID<typeof Service>>(uuid: string | T, subType: string): Service | undefined {
    for (const service of this.services) {
      if (typeof uuid === "string" && (service.displayName === uuid || service.name === uuid) && service.subtype === subType) {
        return service;
      } else if (typeof uuid === "function" && ((service instanceof uuid) || (uuid.UUID === service.UUID)) && service.subtype === subType) {
        return service;
      }
    }

    return undefined;
  }

  /**
   * Returns the bridging accessory if this accessory is bridged.
   * Otherwise returns itself.
   *
   * @returns the primary accessory
   */
  public getPrimaryAccessory = (): Accessory => {
    return this.bridged? this.bridge!: this;
  }

  /**
   * @deprecated Not supported anymore
   */
  public updateReachability(reachable: boolean): void {
    if (!this.bridged)
      throw new Error("Cannot update reachability on non-bridged accessory!");
    this.reachable = reachable;

    debug('Reachability update is no longer being supported.');
  }

  public addBridgedAccessory(accessory: Accessory, deferUpdate: boolean = false): Accessory {
    if (accessory._isBridge) {
      throw new Error("Cannot Bridge another Bridge!");
    }

    // check for UUID conflict
    for (const existing of this.bridgedAccessories) {
      if (existing.UUID === accessory.UUID) {
        throw new Error("Cannot add a bridged Accessory with the same UUID as another bridged Accessory: " + existing.UUID);
      }
    }

    if (this.bridgedAccessories.length >= MAX_ACCESSORIES) {
      throw new Error("Cannot Bridge more than " + MAX_ACCESSORIES + " Accessories");
    }

    // listen for changes in ANY characteristics of ANY services on this Accessory
    accessory.on(AccessoryEventTypes.SERVICE_CHARACTERISTIC_CHANGE, change => this.handleCharacteristicChangeEvent(accessory, change.service, change));
    accessory.on(AccessoryEventTypes.SERVICE_CONFIGURATION_CHANGE, this.enqueueConfigurationUpdate.bind(this));
    accessory.on(AccessoryEventTypes.CHARACTERISTIC_WARNING, this.handleCharacteristicWarning.bind(this));

    accessory.bridged = true;
    accessory.bridge = this;

    this.bridgedAccessories.push(accessory);

    this.controllerStorage.linkAccessory(accessory); // init controllers of bridged accessory

    if(!deferUpdate) {
      this.enqueueConfigurationUpdate();
    }

    return accessory;
  }

  public addBridgedAccessories(accessories: Accessory[]): void {
    for (const accessory of accessories) {
      this.addBridgedAccessory(accessory, true);
    }

    this.enqueueConfigurationUpdate();
  }

  public removeBridgedAccessory(accessory: Accessory, deferUpdate: boolean): void {
    if (accessory._isBridge)
      throw new Error("Cannot Bridge another Bridge!");

    // check for UUID conflict
    const foundMatchAccessory = this.bridgedAccessories.findIndex((existing) => {
      return existing.UUID === accessory.UUID
    });

    if (foundMatchAccessory === -1)
      throw new Error("Cannot find the bridged Accessory to remove.");

    this.bridgedAccessories.splice(foundMatchAccessory, 1);

    accessory.removeAllListeners();

    if(!deferUpdate) {
      this.enqueueConfigurationUpdate();
    }
  }

  public removeBridgedAccessories(accessories: Accessory[]): void {
    for (const accessory of accessories) {
      this.removeBridgedAccessory(accessory, true);
    }

    this.enqueueConfigurationUpdate();
  }

  public removeAllBridgedAccessories(): void {
    for (let i = this.bridgedAccessories.length - 1; i >= 0; i --) {
      this.removeBridgedAccessory(this.bridgedAccessories[i], true);
    }
    this.enqueueConfigurationUpdate();
  }

  private getCharacteristicByIID(iid: number): Characteristic | undefined {
    for (const service of this.services) {
      const characteristic = service.getCharacteristicByIID(iid);

      if (characteristic) {
        return characteristic;
      }
    }
  }

  protected getAccessoryByAID(aid: number): Accessory | undefined {
    if (aid === 1) {
      return this;
    }

    for (const accessory of this.bridgedAccessories) {
      if (accessory.aid === aid) {
        return accessory;
      }
    }

    return undefined;
  }

  protected findCharacteristic(aid: number, iid: number): Characteristic | undefined {
    const accessory = this.getAccessoryByAID(aid);
    return accessory && accessory.getCharacteristicByIID(iid);
  }

  // noinspection JSDeprecatedSymbols
  /**
   * Method is used to configure an old style CameraSource.
   * The CameraSource API was fully replaced by the new Controller API used by {@link CameraController}.
   * The {@link CameraStreamingDelegate} used by the CameraController is the equivalent to the old CameraSource.
   *
   * The new Controller API is much more refined and robust way of "grouping" services together.
   * It especially is intended to fully support serialization/deserialization to/from persistent storage.
   * This feature is also gained when using the old style CameraSource API.
   * The {@link CameraStreamingDelegate} improves on the overall camera API though and provides some reworked
   * type definitions and a refined callback interface to better signal errors to the requesting HomeKit device.
   * It is advised to update to it.
   *
   * Full backwards compatibility is currently maintained. A legacy CameraSource will be wrapped into an Adapter.
   * All legacy StreamControllers in the "streamControllers" property will be replaced by CameraRTPManagement instances.
   * Any services in the "services" property which are one of the following are ignored:
   *     - CameraRTPStreamManagement
   *     - CameraOperatingMode
   *     - CameraEventRecordingManagement
   *
   * @param cameraSource {LegacyCameraSource}
   * @deprecated please refer to the new {@see CameraController} API and {@link configureController}
   */
  public configureCameraSource(cameraSource: LegacyCameraSource): CameraController {
    if (cameraSource.streamControllers.length === 0) {
      throw new Error("Malformed legacy CameraSource. Did not expose any StreamControllers!");
    }

    const options = cameraSource.streamControllers[0].options; // grab options from one of the StreamControllers
    const cameraControllerOptions: CameraControllerOptions = { // build new options set
      cameraStreamCount: cameraSource.streamControllers.length,
      streamingOptions: options,
      delegate: new LegacyCameraSourceAdapter(cameraSource),
    };

    const cameraController = new CameraController(cameraControllerOptions, true); // create CameraController in legacy mode
    this.configureController(cameraController);

    // we try here to be as good as possibly of keeping current behaviour
    cameraSource.services.forEach(service => {
      if (service.UUID === Service.CameraRTPStreamManagement.UUID || service.UUID === Service.CameraOperatingMode.UUID
          || service.UUID === Service.CameraRecordingManagement.UUID) {
        return; // ignore those services, as they get replaced by the RTPStreamManagement
      }

      // all other services get added. We can't really control possibly linking to any of those ignored services
      // so this is really only half baked stuff.
      this.addService(service);
    });

    // replace stream controllers; basically only to still support the "forceStop" call
    // noinspection JSDeprecatedSymbols
    cameraSource.streamControllers = cameraController.streamManagements as StreamController[];

    return cameraController; // return the reference for the controller (maybe this could be useful?)
  }

  /**
   * This method is used to setup a new Controller for this accessory. See {@see Controller} for a more detailed
   * explanation what a Controller is and what it is capable of.
   *
   * The controller can be passed as an instance of the class or as a constructor (without any necessary parameters)
   * for a new Controller.
   * Only one Controller of a given {@link ControllerIdentifier} can be configured for a given Accessory.
   *
   * When called, it will be checked if there are any services and persistent data the Controller (for the given
   * {@link ControllerIdentifier}) can be restored from. Otherwise the Controller will be created with new services.
   *
   *
   * @param controllerConstructor {Controller | ControllerConstructor}
   */
  public configureController(controllerConstructor: Controller | ControllerConstructor) {
    const controller = typeof controllerConstructor === "function"
        ? new controllerConstructor() // any custom constructor arguments should be passed before using .bind(...)
        : controllerConstructor;
    const id = controller.controllerId();

    if (this.controllers[id]) {
      throw new Error(`A Controller with the type/id '${id}' was already added to the accessory ${this.displayName}`);
    }

    const savedServiceMap = this.serializedControllers && this.serializedControllers[id];
    let serviceMap: ControllerServiceMap;

    if (savedServiceMap) { // we found data to restore from
      const clonedServiceMap = clone(savedServiceMap);
      const updatedServiceMap = controller.initWithServices(savedServiceMap); // init controller with existing services
      serviceMap = updatedServiceMap || savedServiceMap; // initWithServices could return a updated serviceMap, otherwise just use the existing one

      if (updatedServiceMap) { // controller returned a ServiceMap and thus signaled a updated set of services
        // clonedServiceMap is altered by this method, should not be touched again after this call (for the future people)
        this.handleUpdatedControllerServiceMap(clonedServiceMap, updatedServiceMap);
      }

      controller.configureServices(); // let the controller setup all its handlers

      // remove serialized data from our dictionary:
      delete this.serializedControllers![id];
      if (Object.entries(this.serializedControllers!).length === 0) {
        this.serializedControllers = undefined;
      }
    } else {
      serviceMap = controller.constructServices(); // let the controller create his services
      controller.configureServices(); // let the controller setup all its handlers

      Object.values(serviceMap).forEach(service => {
        if (service && !this.services.includes(service)) {
          this.addService(service);
        }
      });
    }


    // --- init handlers and setup context ---
    const context: ControllerContext = {
      controller: controller,
      serviceMap: serviceMap,
    };

    if (isSerializableController(controller)) {
      this.controllerStorage.trackController(controller);
    }

    this.controllers[id] = context;

    if (controller instanceof CameraController) { // save CameraController for Snapshot handling
      this.activeCameraController = controller;
    }
  }

  /**
   * This method will remove a given Controller from this accessory.
   * The controller object will be restored to its initial state.
   * This also means that any event handlers setup for the controller will be removed.
   *
   * @param controller - The controller which should be removed from the accessory.
   */
  public removeController(controller: Controller): void {
    const id = controller.controllerId();

    const storedController = this.controllers[id];
    if (storedController) {
      if (storedController.controller !== controller) {
        throw new Error("[" + this.displayName + "] tried removing a controller with the id/type '" + id + "' though provided controller isn't the same which is registered!");
      }

      if (isSerializableController(controller)) {
        // this will reset the state change delegate before we call handleControllerRemoved()
        this.controllerStorage.untrackController(controller);
      }

      if (controller.handleFactoryReset) {
        controller.handleFactoryReset();
      }
      controller.handleControllerRemoved();

      delete this.controllers[id];

      if (this.activeCameraController === controller) {
        this.activeCameraController = undefined;
      }

      Object.values(storedController.serviceMap).forEach(service => {
        if (service) {
          this.removeService(service);
        }
      });
    }

    if (this.serializedControllers) {
      delete this.serializedControllers[id];
    }
  }

  private handleAccessoryUnpairedForControllers(): void {
    for (const context of Object.values(this.controllers)) {
      const controller = context.controller;
      if (controller.handleFactoryReset) { // if the controller implements handleFactoryReset, setup event handlers for this controller
        controller.handleFactoryReset();
      }

      if (isSerializableController(controller)) {
        this.controllerStorage.purgeControllerData(controller);
      }
    }
  }

  private handleUpdatedControllerServiceMap(originalServiceMap: ControllerServiceMap, updatedServiceMap: ControllerServiceMap) {
    updatedServiceMap = clone(updatedServiceMap); // clone it so we can alter it

    Object.keys(originalServiceMap).forEach(name => { // this loop removed any services contained in both ServiceMaps
      const service = originalServiceMap[name];
      const updatedService = updatedServiceMap[name];

      if (service && updatedService) { // we check all names contained in both ServiceMaps for changes
        delete originalServiceMap[name]; // delete from original ServiceMap so it will only contain deleted services at the end
        delete updatedServiceMap[name]; // delete from updated ServiceMap so it will only contain added services at the end

        if (service !== updatedService) {
          this.removeService(service);
          this.addService(updatedService);
        }
      }
    });

    // now originalServiceMap contains only deleted services and updateServiceMap only added services

    Object.values(originalServiceMap).forEach(service => {
      if (service) {
        this.removeService(service);
      }
    });
    Object.values(updatedServiceMap).forEach(service => {
      if (service) {
        this.addService(service);
      }
    });
  }

  setupURI(): string {
    if (this._setupURI) {
      return this._setupURI;
    }

    const buffer = Buffer.alloc(8);
    const setupCode = this._accessoryInfo && parseInt(this._accessoryInfo.pincode.replace(/-/g, ''), 10);

    let value_low = setupCode!;
    const value_high = this._accessoryInfo && this._accessoryInfo.category >> 1;

    value_low |= 1 << 28; // Supports IP;

    buffer.writeUInt32BE(value_low, 4);

    if (this._accessoryInfo && this._accessoryInfo.category & 1) {
      buffer[4] = buffer[4] | 1 << 7;
    }

    buffer.writeUInt32BE(value_high!, 0);

    let encodedPayload = (buffer.readUInt32BE(4) + (buffer.readUInt32BE(0) * Math.pow(2, 32))).toString(36).toUpperCase();

    if (encodedPayload.length != 9) {
      for (let i = 0; i <= 9 - encodedPayload.length; i++) {
        encodedPayload = "0" + encodedPayload;
      }
    }

    this._setupURI = "X-HM://" + encodedPayload + this._setupID;
    return this._setupURI;
  }

  /**
   * This method is called right before the accessory is published. It should be used to check for common
   * mistakes in Accessory structured, which may lead to HomeKit rejecting the accessory when pairing.
   * If it is called on a bridge it will call this method for all bridged accessories.
   */
  private validateAccessory(mainAccessory?: boolean) {
    const service = this.getService(Service.AccessoryInformation);
    if (!service) {
      console.log("HAP-NodeJS WARNING: The accessory '" + this.displayName + "' is getting published without a AccessoryInformation service. " +
        "This might prevent the accessory from being added to the Home app or leading to the accessory being unresponsive!");
    } else {
      const checkValue = (name: string, value?: any) => {
        if (!value) {
          console.log("HAP-NodeJS WARNING: The accessory '" + this.displayName + "' is getting published with the characteristic '" + name + "'" +
            " (of the AccessoryInformation service) not having a value set. " +
            "This might prevent the accessory from being added to the Home App or leading to the accessory being unresponsive!");
        }
      };

      const model = service.getCharacteristic(Characteristic.Model).value;
      const serialNumber = service.getCharacteristic(Characteristic.SerialNumber).value;
      const firmwareRevision = service.getCharacteristic(Characteristic.FirmwareRevision).value;
      const name = service.getCharacteristic(Characteristic.Name).value;

      checkValue("Model", model);
      checkValue("SerialNumber", serialNumber);
      checkValue("FirmwareRevision", firmwareRevision);
      checkValue("Name", name);
    }

    if (mainAccessory) {
      // the main accessory which is advertised via bonjour must have a name with length <= 63 (limitation of DNS FQDN names)
      assert(Buffer.from(this.displayName, "utf8").length <= 63, "Accessory displayName cannot be longer than 63 bytes!");
    }

    if (this.bridged) {
      this.bridgedAccessories.forEach(accessory => accessory.validateAccessory());
    }
  }

  /**
   * Assigns aid/iid to ourselves, any Accessories we are bridging, and all associated Services+Characteristics. Uses
   * the provided identifierCache to keep IDs stable.
   */
  _assignIDs(identifierCache: IdentifierCache): void {

    // if we are responsible for our own identifierCache, start the expiration process
    // also check weather we want to have an expiration process
    if (this._identifierCache && this.shouldPurgeUnusedIDs) {
      this._identifierCache.startTrackingUsage();
    }

    if (this.bridged) {
      // This Accessory is bridged, so it must have an aid > 1. Use the provided identifierCache to
      // fetch or assign one based on our UUID.
      this.aid = identifierCache.getAID(this.UUID)
    } else {
      // Since this Accessory is the server (as opposed to any Accessories that may be bridged behind us),
      // we must have aid = 1
      this.aid = 1;
    }

    for (const service of this.services) {
      if (this._isBridge) {
        service._assignIDs(identifierCache, this.UUID, 2000000000);
      } else {
        service._assignIDs(identifierCache, this.UUID);
      }
    }

    // now assign IDs for any Accessories we are bridging
    for (const accessory of this.bridgedAccessories) {
      accessory._assignIDs(identifierCache);
    }

    // expire any now-unused cache keys (for Accessories, Services, or Characteristics
    // that have been removed since the last call to assignIDs())
    if (this._identifierCache) {
      //Check weather we want to purge the unused ids
      if (this.shouldPurgeUnusedIDs)
        this._identifierCache.stopTrackingUsageAndExpireUnused();
      //Save in case we have new ones
      this._identifierCache.save();
    }
  }

  disableUnusedIDPurge = () => {
    this.shouldPurgeUnusedIDs = false;
  }

  enableUnusedIDPurge = () => {
    this.shouldPurgeUnusedIDs = true;
  }

  /**
   * Manually purge the unused ids if you like, comes handy
   * when you have disabled auto purge so you can do it manually
   */
  purgeUnusedIDs = () => {
    //Cache the state of the purge mechanism and set it to true
    const oldValue = this.shouldPurgeUnusedIDs;
    this.shouldPurgeUnusedIDs = true;

    //Reassign all ids
    this._assignIDs(this._identifierCache!);

    //Revert back the purge mechanism state
    this.shouldPurgeUnusedIDs = oldValue;
  }

  /**
   * Returns a JSON representation of this accessory suitable for delivering to HAP clients.
   */
  private async toHAP(connection: HAPConnection, contactGetHandlers = true): Promise<AccessoryJsonObject[]> {
    assert(this.aid, "aid cannot be undefined for accessory '" + this.displayName + "'");
    assert(this.services.length, "accessory '" + this.displayName + "' does not have any services!");

    const accessory: AccessoryJsonObject = {
      aid: this.aid!,
      services: await Promise.all(this.services.map(service => service.toHAP(connection, contactGetHandlers))),
    };

    const accessories: AccessoryJsonObject[] = [accessory];

    if (!this.bridged) {
      accessories.push(... await Promise.all(
        this.bridgedAccessories
          .map(accessory => accessory.toHAP(connection, contactGetHandlers).then(value => value[0]))
      ));
    }

    return accessories;
  }

  /**
   * Returns a JSON representation of this accessory without characteristic values.
   */
  private internalHAPRepresentation(assignIds: boolean = true): AccessoryJsonObject[] {
    if (assignIds) {
      this._assignIDs(this._identifierCache!); // make sure our aid/iid's are all assigned
    }
    assert(this.aid, "aid cannot be undefined for accessory '" + this.displayName + "'");
    assert(this.services.length, "accessory '" + this.displayName + "' does not have any services!");

    const accessory: AccessoryJsonObject = {
      aid: this.aid!,
      services: this.services.map(service => service.internalHAPRepresentation()),
    };

    const accessories: AccessoryJsonObject[] = [accessory];

    if (!this.bridged) {
      for (const accessory of this.bridgedAccessories) {
        accessories.push(accessory.internalHAPRepresentation(false)[0]);
      }
    }

    return accessories;
  }

  /**
   * Publishes this Accessory on the local network for iOS clients to communicate with.
   *
   * @param {Object} info - Required info for publishing.
   * @param allowInsecureRequest - Will allow unencrypted and unauthenticated access to the http server
   * @param {string} info.username - The "username" (formatted as a MAC address - like "CC:22:3D:E3:CE:F6") of
   *                                this Accessory. Must be globally unique from all Accessories on your local network.
   * @param {string} info.pincode - The 8-digit pincode for clients to use when pairing this Accessory. Must be formatted
   *                               as a string like "031-45-154".
   * @param {string} info.category - One of the values of the Accessory.Category enum, like Accessory.Category.SWITCH.
   *                                This is a hint to iOS clients about what "type" of Accessory this represents, so
   *                                that for instance an appropriate icon can be drawn for the user while adding a
   *                                new Accessory.
   */
  public publish(info: PublishInfo, allowInsecureRequest?: boolean): void {
    // noinspection JSDeprecatedSymbols
    if (!info.advertiser && info.useLegacyAdvertiser != null) {
      // noinspection JSDeprecatedSymbols
      info.advertiser = info.useLegacyAdvertiser? MDNSAdvertiser.BONJOUR: MDNSAdvertiser.CIAO;
      console.warn('DEPRECATED The PublishInfo.useLegacyAdvertiser option has been removed. Please use the PublishInfo.advertiser property to enable "ciao" (useLegacyAdvertiser=false) ' +
        'or "bonjour-hap" (useLegacyAdvertiser=true) mdns advertiser libraries!')
    }

    // noinspection JSDeprecatedSymbols
    if (info.mdns && info.advertiser !== MDNSAdvertiser.BONJOUR) {
      console.log("DEPRECATED user supplied a custom 'mdns' option. This option is deprecated and ignored. " +
        "Please move to the new 'bind' option.");
    }

    let service = this.getService(Service.ProtocolInformation);
    if (!service) {
      service = this.addService(Service.ProtocolInformation) // add the protocol information service to the primary accessory
    }
    service.setCharacteristic(Characteristic.Version, CiaoAdvertiser.protocolVersionService);

    if (this.lastKnownUsername && this.lastKnownUsername !== info.username) { // username changed since last publish
      Accessory.cleanupAccessoryData(this.lastKnownUsername); // delete old Accessory data
    }

    if (info.addIdentifyingMaterial ?? true) {
      // adding some identifying material to our displayName
      this.displayName = this.displayName + " " + crypto.createHash('sha512')
        .update(info.username, 'utf8')
        .digest('hex').slice(0, 4).toUpperCase();
      this.getService(Service.AccessoryInformation)!.updateCharacteristic(Characteristic.Name, this.displayName);
    }

    // attempt to load existing AccessoryInfo from disk
    this._accessoryInfo = AccessoryInfo.load(info.username);

    // if we don't have one, create a new one.
    if (!this._accessoryInfo) {
      debug("[%s] Creating new AccessoryInfo for our HAP server", this.displayName);
      this._accessoryInfo = AccessoryInfo.create(info.username);
    }

    if (info.setupID) {
      this._setupID = info.setupID;
    } else if (this._accessoryInfo.setupID === undefined || this._accessoryInfo.setupID === "") {
      this._setupID = Accessory._generateSetupID();
    } else {
      this._setupID = this._accessoryInfo.setupID;
    }

    this._accessoryInfo.setupID = this._setupID;

    // make sure we have up-to-date values in AccessoryInfo, then save it in case they changed (or if we just created it)
    this._accessoryInfo.displayName = this.displayName;
    this._accessoryInfo.model = this.getService(Service.AccessoryInformation)!.getCharacteristic(Characteristic.Model).value as string;
    this._accessoryInfo.category = info.category || Categories.OTHER;
    this._accessoryInfo.pincode = info.pincode;
    this._accessoryInfo.save();

    // create our IdentifierCache so we can provide clients with stable aid/iid's
    this._identifierCache = IdentifierCache.load(info.username);

    // if we don't have one, create a new one.
    if (!this._identifierCache) {
      debug("[%s] Creating new IdentifierCache", this.displayName);
      this._identifierCache = new IdentifierCache(info.username);
    }

    //If it's bridge and there are not accessories already assigned to the bridge
    //probably purge is not needed since it's going to delete all the ids
    //of accessories that might be added later. Useful when dynamically adding
    //accessories.
    if (this._isBridge && this.bridgedAccessories.length == 0) {
      this.disableUnusedIDPurge();
      this.controllerStorage.purgeUnidentifiedAccessoryData = false;
    }

    this.controllerStorage.load(info.username); // initializing controller data

    // assign aid/iid
    this._assignIDs(this._identifierCache);

    // get our accessory information in HAP format and determine if our configuration (that is, our
    // Accessories/Services/Characteristics) has changed since the last time we were published. make
    // sure to omit actual values since these are not part of the "configuration".
    const config = this.internalHAPRepresentation(false); // TODO ensure this stuff is ordered
    // TODO queue this check until about 5 seconds after startup, allowing some last changes after the publish call
    //   without constantly incrementing the current config number
    this._accessoryInfo.checkForCurrentConfigurationNumberIncrement(config, true);

    this.validateAccessory(true);

    // create our Advertiser which broadcasts our presence over mdns
    const parsed = Accessory.parseBindOption(info);

    switch (info.advertiser ?? MDNSAdvertiser.BONJOUR) {
      case MDNSAdvertiser.CIAO:
        this._advertiser = new CiaoAdvertiser(this._accessoryInfo, {
          interface: parsed.advertiserAddress
        }, {
          restrictedAddresses: parsed.serviceRestrictedAddress,
          disabledIpv6: parsed.serviceDisableIpv6,
        });
        break;
      case MDNSAdvertiser.BONJOUR:
        // noinspection JSDeprecatedSymbols
        this._advertiser = new BonjourHAPAdvertiser(this._accessoryInfo, info.mdns, {
          restrictedAddresses: parsed.serviceRestrictedAddress,
          disabledIpv6: parsed.serviceDisableIpv6,
        });
        break;
      default:
        throw new Error("Unsupported advertiser setting: '" + info.advertiser + "'");
    }
    this._advertiser.on(AdvertiserEvent.UPDATED_NAME, name => {
      this.displayName = name;
      if (this._accessoryInfo) {
        this._accessoryInfo.displayName = name;
        this._accessoryInfo.save();
      }

      // bonjour service name MUST match the name in the accessory information service
      this.getService(Service.AccessoryInformation)!
        .updateCharacteristic(Characteristic.Name, name);
    });

    // create our HAP server which handles all communication between iOS devices and us
    this._server = new HAPServer(this._accessoryInfo);
    this._server.allowInsecureRequest = !!allowInsecureRequest;
    this._server.on(HAPServerEventTypes.LISTENING, this.onListening.bind(this));
    this._server.on(HAPServerEventTypes.IDENTIFY, this.identificationRequest.bind(this, false));
    this._server.on(HAPServerEventTypes.PAIR, this.handleInitialPairSetupFinished.bind(this));
    this._server.on(HAPServerEventTypes.ADD_PAIRING, this.handleAddPairing.bind(this));
    this._server.on(HAPServerEventTypes.REMOVE_PAIRING, this.handleRemovePairing.bind(this));
    this._server.on(HAPServerEventTypes.LIST_PAIRINGS, this.handleListPairings.bind(this));
    this._server.on(HAPServerEventTypes.ACCESSORIES, this.handleAccessories.bind(this));
    this._server.on(HAPServerEventTypes.GET_CHARACTERISTICS, this.handleGetCharacteristics.bind(this));
    this._server.on(HAPServerEventTypes.SET_CHARACTERISTICS, this.handleSetCharacteristics.bind(this));
    this._server.on(HAPServerEventTypes.CONNECTION_CLOSED, this.handleHAPConnectionClosed.bind(this));
    this._server.on(HAPServerEventTypes.REQUEST_RESOURCE, this.handleResource.bind(this));

    this._server.listen(info.port, parsed.serverAddress);
  }

  /**
   * Removes this Accessory from the local network
   * Accessory object will no longer valid after invoking this method
   * Trying to invoke publish() on the object will result undefined behavior
   */
  public destroy(): void {
    this.unpublish();

    if (this._accessoryInfo) {
      Accessory.cleanupAccessoryData(this._accessoryInfo.username);

      this._accessoryInfo = undefined;
      this._identifierCache = undefined;
      this.controllerStorage = new ControllerStorage(this);
    }
    this.removeAllListeners();
  }

  public unpublish(): void {
    if (this._server) {
      this._server.destroy();
      this._server = undefined;
    }
    if (this._advertiser) {
      // noinspection JSIgnoredPromiseFromCall
      this._advertiser.destroy();
      this._advertiser = undefined;
    }
  }

  private enqueueConfigurationUpdate(): void {
    if (this.configurationChangeDebounceTimeout) {
      return; // already enqueued
    }

    this.configurationChangeDebounceTimeout = setTimeout(() => {
      this.configurationChangeDebounceTimeout = undefined;

      if (this._advertiser && this._advertiser) {
        // get our accessory information in HAP format and determine if our configuration (that is, our
        // Accessories/Services/Characteristics) has changed since the last time we were published. make
        // sure to omit actual values since these are not part of the "configuration".
        const config = this.internalHAPRepresentation(); // TODO ensure this stuff is ordered
        if (this._accessoryInfo?.checkForCurrentConfigurationNumberIncrement(config)) {
          this._advertiser.updateAdvertisement();
        }
      }
    }, 1000);
    this.configurationChangeDebounceTimeout.unref();
    // 1d is fine, HomeKit is built that with configuration updates no iid or aid conflicts occur.
    // Thus the only thing happening when the txt update arrives late is already removed accessories/services
    // not responding or new accessories/services not yet shown
  }

  private onListening(port: number, hostname: string): void {
    assert(this._advertiser, "Advertiser wasn't created at onListening!");
    // the HAP server is listening, so we can now start advertising our presence.
    this._advertiser!.initPort(port);
    // noinspection JSIgnoredPromiseFromCall
    this._advertiser!.startAdvertising();
    this.emit(AccessoryEventTypes.LISTENING, port, hostname);
  }

  private handleInitialPairSetupFinished(username: string, publicKey: Buffer, callback: PairCallback): void {
    debug("[%s] Paired with client %s", this.displayName, username);

    this._accessoryInfo && this._accessoryInfo.addPairedClient(username, publicKey, PermissionTypes.ADMIN);
    this._accessoryInfo && this._accessoryInfo.save();

    // update our advertisement so it can pick up on the paired status of AccessoryInfo
    this._advertiser && this._advertiser.updateAdvertisement();

    callback();

    this.emit(AccessoryEventTypes.PAIRED);
  }

  private handleAddPairing(connection: HAPConnection, username: string, publicKey: Buffer, permission: PermissionTypes, callback: AddPairingCallback): void {
    if (!this._accessoryInfo) {
      callback(TLVErrorCode.UNAVAILABLE);
      return;
    }

    if (!this._accessoryInfo.hasAdminPermissions(connection.username!)) {
      callback(TLVErrorCode.AUTHENTICATION);
      return;
    }

    const existingKey = this._accessoryInfo.getClientPublicKey(username);
    if (existingKey) {
      if (existingKey.toString() !== publicKey.toString()) {
        callback(TLVErrorCode.UNKNOWN);
        return;
      }

      this._accessoryInfo.updatePermission(username, permission);
    } else {
      this._accessoryInfo.addPairedClient(username, publicKey, permission);
    }

    this._accessoryInfo.save();
    // there should be no need to update advertisement
    callback(0);
  }

  private handleRemovePairing(connection: HAPConnection, username: HAPUsername, callback: RemovePairingCallback): void {
    if (!this._accessoryInfo) {
      callback(TLVErrorCode.UNAVAILABLE);
      return;
    }

    if (!this._accessoryInfo.hasAdminPermissions(connection.username!)) {
      callback(TLVErrorCode.AUTHENTICATION);
      return;
    }

    this._accessoryInfo.removePairedClient(connection, username);
    this._accessoryInfo.save();

    callback(0); // first of all ensure the pairing is removed before we advertise availability again

    if (!this._accessoryInfo.paired()) {
      this._advertiser && this._advertiser.updateAdvertisement();
      this.emit(AccessoryEventTypes.UNPAIRED);

      this.handleAccessoryUnpairedForControllers();
      for (const accessory of this.bridgedAccessories) {
        accessory.handleAccessoryUnpairedForControllers();
      }
    }
  }

  private handleListPairings(connection: HAPConnection, callback: ListPairingsCallback): void {
    if (!this._accessoryInfo) {
      callback(TLVErrorCode.UNAVAILABLE);
      return;
    }

    if (!this._accessoryInfo.hasAdminPermissions(connection.username!)) {
      callback(TLVErrorCode.AUTHENTICATION);
      return;
    }

    callback(0, this._accessoryInfo.listPairings());
  }

  private handleAccessories(connection: HAPConnection, callback: AccessoriesCallback): void {
    this._assignIDs(this._identifierCache!); // make sure our aid/iid's are all assigned

    const now = Date.now();
    const contactGetHandlers = now - this.lastAccessoriesRequest > 5_000; // we query latest value if last /accessories was more than 5s ago
    this.lastAccessoriesRequest = now;

    this.toHAP(connection, contactGetHandlers).then(value => {
      callback(undefined, {
        accessories: value,
      });
    }, reason => {
      console.error("[" + this.displayName + "] /accessories request error with: " + reason.stack);
      callback({ httpCode: HAPHTTPCode.INTERNAL_SERVER_ERROR, status: HAPStatus.SERVICE_COMMUNICATION_FAILURE });
    });
  }

  private handleGetCharacteristics(connection: HAPConnection, request: CharacteristicsReadRequest, callback: ReadCharacteristicsCallback): void {
    const characteristics: CharacteristicReadData[] = [];
    const response: CharacteristicsReadResponse = { characteristics: characteristics };

    const missingCharacteristics: Set<EventName> = new Set(request.ids.map(id => id.aid + "." + id.iid));
    if (missingCharacteristics.size !== request.ids.length) {
      // if those sizes differ, we have duplicates and can't properly handle that
      callback({ httpCode: HAPHTTPCode.UNPROCESSABLE_ENTITY, status: HAPStatus.INVALID_VALUE_IN_REQUEST });
      return;
    }

    let timeout: NodeJS.Timeout | undefined = setTimeout(() => {
      for (const id of missingCharacteristics) {
        const split = id.split(".");
        const aid = parseInt(split[0], 10);
        const iid = parseInt(split[1], 10);

        const accessory = this.getAccessoryByAID(aid)!;
        const characteristic = accessory.getCharacteristicByIID(iid)!;
        this.sendCharacteristicWarning(characteristic, CharacteristicWarningType.SLOW_READ, "The read handler for the characteristic '" +
          characteristic.displayName + "' on the accessory '" + accessory.displayName + "' was slow to respond!");
      }

      // after a total of 10s we do not longer wait for a request to appear and just return status code timeout
      timeout = setTimeout(() => {
        timeout = undefined;

        for (const id of missingCharacteristics) {
          const split = id.split(".");
          const aid = parseInt(split[0], 10);
          const iid = parseInt(split[1], 10);

          const accessory = this.getAccessoryByAID(aid)!;
          const characteristic = accessory.getCharacteristicByIID(iid)!;
          this.sendCharacteristicWarning(characteristic, CharacteristicWarningType.TIMEOUT_READ, "The read handler for the characteristic '" +
            characteristic.displayName + "' on the accessory '" + accessory.displayName + "' didn't respond at all!. Please check that you properly call the callback!");

          characteristics.push({
            aid: aid,
            iid: iid,
            status: HAPStatus.OPERATION_TIMED_OUT,
          });
        }
        missingCharacteristics.clear();

        callback(undefined, response);
      }, 6000);
      timeout.unref();
    }, 3000);
    timeout.unref();

    for (const id of request.ids) {
      const name = id.aid + "." + id.iid;
      this.handleCharacteristicRead(connection, id, request).then(value => {
        return {
          aid: id.aid,
          iid: id.iid,
          ...value,
        };
      }, reason => { // this error block is only called if hap-nodejs itself messed up
        console.error(`[${this.displayName}] Read request for characteristic ${name} encountered an error: ${reason.stack}`)

        return {
          aid: id.aid,
          iid: id.iid,
          status: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        };
      }).then(value => {
        if (!timeout) {
          return; // if timeout is undefined, response was already sent out
        }

        missingCharacteristics.delete(name);
        characteristics.push(value);

        if (missingCharacteristics.size === 0) {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          callback(undefined, response);
        }
      });
    }
  }

  private async handleCharacteristicRead(connection: HAPConnection, id: CharacteristicId, request: CharacteristicsReadRequest): Promise<PartialCharacteristicReadData> {
    const characteristic = this.findCharacteristic(id.aid, id.iid);

    if (!characteristic) {
      debug('[%s] Could not find a Characteristic with aid of %s and iid of %s', this.displayName, id.aid, id.iid);
      return { status: HAPStatus.INVALID_VALUE_IN_REQUEST };
    }

    if (!characteristic.props.perms.includes(Perms.PAIRED_READ)) { // check if read is allowed for this characteristic
      debug('[%s] Tried reading from characteristic which does not allow reading (aid of %s and iid of %s)', this.displayName, id.aid, id.iid);
      return { status: HAPStatus.WRITE_ONLY_CHARACTERISTIC };
    }

    if (characteristic.props.adminOnlyAccess && characteristic.props.adminOnlyAccess.includes(Access.READ)) {
      let verifiable = true;
      if (!connection.username || !this._accessoryInfo) {
        verifiable = false;
        debug('[%s] Could not verify admin permissions for Characteristic which requires admin permissions for reading (aid of %s and iid of %s)', this.displayName, id.aid, id.iid)
      }

      if (!verifiable || !this._accessoryInfo!.hasAdminPermissions(connection.username!)) {
        return { status: HAPStatus.INSUFFICIENT_PRIVILEGES };
      }
    }

    return characteristic.handleGetRequest(connection).then(value => {
      value = formatOutgoingCharacteristicValue(value, characteristic.props);
      debug('[%s] Got Characteristic "%s" value: "%s"', this.displayName, characteristic!.displayName, value);

      const data: PartialCharacteristicReadData = {
        value: value == undefined? null: value,
      };

      if (request.includeMeta) {
        data.format = characteristic.props.format;
        data.unit = characteristic.props.unit;
        data.minValue = characteristic.props.minValue;
        data.maxValue = characteristic.props.maxValue;
        data.minStep = characteristic.props.minStep;
        data.maxLen = characteristic.props.maxLen || characteristic.props.maxDataLen;
      }
      if (request.includePerms) {
        data.perms = characteristic.props.perms;
      }
      if (request.includeType) {
        data.type = toShortForm(this.UUID);
      }
      if (request.includeEvent) {
        data.ev = connection.hasEventNotifications(id.aid, id.iid);
      }

      return data;
    }, (reason: HAPStatus) => {
      // @ts-expect-error
      debug('[%s] Error getting value for characteristic "%s": %s', this.displayName, characteristic.displayName, HAPStatus[reason]);
      return { status: reason };
    });
  }

  private handleSetCharacteristics(connection: HAPConnection, writeRequest: CharacteristicsWriteRequest, callback: WriteCharacteristicsCallback): void {
    debug("[%s] Processing characteristic set: %s", this.displayName, JSON.stringify(writeRequest));

    let writeState: WriteRequestState = WriteRequestState.REGULAR_REQUEST;
    if (writeRequest.pid !== undefined) { // check for timed writes
      if (connection.timedWritePid === writeRequest.pid) {
        writeState = WriteRequestState.TIMED_WRITE_AUTHENTICATED;
        clearTimeout(connection.timedWriteTimeout!);
        connection.timedWritePid = undefined;
        connection.timedWriteTimeout = undefined;

        debug("[%s] Timed write request got acknowledged for pid %d", this.displayName, writeRequest.pid);
      } else {
        writeState = WriteRequestState.TIMED_WRITE_REJECTED;
        debug("[%s] TTL for timed write request has probably expired for pid %d", this.displayName, writeRequest.pid);
      }
    }

    const characteristics: CharacteristicWriteData[] = [];
    const response: CharacteristicsWriteResponse = { characteristics: characteristics };

    const missingCharacteristics: Set<EventName> = new Set(
      writeRequest.characteristics
        .map(characteristic => characteristic.aid + "." + characteristic.iid)
    );
    if (missingCharacteristics.size !== writeRequest.characteristics.length) {
      // if those sizes differ, we have duplicates and can't properly handle that
      callback({ httpCode: HAPHTTPCode.UNPROCESSABLE_ENTITY, status: HAPStatus.INVALID_VALUE_IN_REQUEST });
      return;
    }

    let timeout: NodeJS.Timeout | undefined = setTimeout(() => {
      for (const id of missingCharacteristics) {
        const split = id.split(".");
        const aid = parseInt(split[0], 10);
        const iid = parseInt(split[1], 10);

        const accessory = this.getAccessoryByAID(aid)!;
        const characteristic = accessory.getCharacteristicByIID(iid)!;
        this.sendCharacteristicWarning(characteristic, CharacteristicWarningType.SLOW_WRITE, "The write handler for the characteristic '" +
          characteristic.displayName + "' on the accessory '" + accessory.displayName + "' was slow to respond!");
      }

      // after a total of 10s we do not longer wait for a request to appear and just return status code timeout
      timeout = setTimeout(() => {
        timeout = undefined;

        for (const id of missingCharacteristics) {
          const split = id.split(".");
          const aid = parseInt(split[0], 10);
          const iid = parseInt(split[1], 10);

          const accessory = this.getAccessoryByAID(aid)!;
          const characteristic = accessory.getCharacteristicByIID(iid)!;
          this.sendCharacteristicWarning(characteristic, CharacteristicWarningType.TIMEOUT_WRITE, "The write handler for the characteristic '" +
            characteristic.displayName + "' on the accessory '" + accessory.displayName + "' didn't respond at all!. Please check that you properly call the callback!");

          characteristics.push({
            aid: aid,
            iid: iid,
            status: HAPStatus.OPERATION_TIMED_OUT,
          });
        }
        missingCharacteristics.clear();

        callback(undefined, response);
      }, 6000);
      timeout.unref();
    }, 3000);
    timeout.unref();

    for (const data of writeRequest.characteristics) {
      const name = data.aid + "." + data.iid;
      this.handleCharacteristicWrite(connection, data, writeState).then(value => {
        return {
          aid: data.aid,
          iid: data.iid,
          ...value,
        };
      }, reason => { // this error block is only called if hap-nodejs itself messed up
        console.error(`[${this.displayName}] Write request for characteristic ${name} encountered an error: ${reason.stack}`)

        return {
          aid: data.aid,
          iid: data.iid,
          status: HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        };
      }).then(value => {
        if (!timeout) {
          return; // if timeout is undefined, response was already sent out
        }

        missingCharacteristics.delete(name);
        characteristics.push(value);

        if (missingCharacteristics.size === 0) { // if everything returned send the response
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          callback(undefined, response);
        }
      })
    }
  }

  private async handleCharacteristicWrite(connection: HAPConnection, data: CharacteristicWrite, writeState: WriteRequestState): Promise<PartialCharacteristicWriteData> {
    const characteristic = this.findCharacteristic(data.aid, data.iid);
    let evResponse: boolean | undefined = undefined;

    if (!characteristic) {
      debug('[%s] Could not find a Characteristic with aid of %s and iid of %s', this.displayName, data.aid, data.iid);
      return { status: HAPStatus.INVALID_VALUE_IN_REQUEST };
    }

    if (writeState === WriteRequestState.TIMED_WRITE_REJECTED) {
      return { status: HAPStatus.INVALID_VALUE_IN_REQUEST };
    }

    if (data.ev != undefined) { // register/unregister event notifications
      const notificationsEnabled = connection.hasEventNotifications(data.aid, data.iid);

      // it seems like the Home App sends unregister requests for characteristics which don't have notify permissions
      // see https://github.com/homebridge/HAP-NodeJS/issues/868
      if (notificationsEnabled != data.ev) {
        if (!characteristic.props.perms.includes(Perms.NOTIFY)) { // check if notify is allowed for this characteristic
          debug('[%s] Tried %s notifications for Characteristic which does not allow notify (aid of %s and iid of %s)',
            this.displayName, data.ev? "enabling": "disabling", data.aid, data.iid);
          return { status: HAPStatus.NOTIFICATION_NOT_SUPPORTED };
        }

        if (characteristic.props.adminOnlyAccess && characteristic.props.adminOnlyAccess.includes(Access.NOTIFY)) {
          let verifiable = true;
          if (!connection.username || !this._accessoryInfo) {
            verifiable = false;
            debug('[%s] Could not verify admin permissions for Characteristic which requires admin permissions for notify (aid of %s and iid of %s)', this.displayName, data.aid, data.iid)
          }

          if (!verifiable || !this._accessoryInfo!.hasAdminPermissions(connection.username!)) {
            return { status: HAPStatus.INSUFFICIENT_PRIVILEGES };
          }
        }

        // we already checked that data.ev != notificationsEnabled, thus just do whatever the connection asks for
        if (data.ev) {
          connection.enableEventNotifications(data.aid, data.iid);
          characteristic.subscribe();
          evResponse = true;
          debug('[%s] Registered Characteristic "%s" on "%s" for events', connection.remoteAddress, characteristic.displayName, this.displayName);
        } else {
          characteristic.unsubscribe();
          connection.disableEventNotifications(data.aid, data.iid);
          evResponse = false;
          debug('[%s] Unregistered Characteristic "%s" on "%s" for events', connection.remoteAddress, characteristic.displayName, this.displayName);
        }
      }
      // response is returned below in the else block
    }

    if (data.value != undefined) {
      if (!characteristic.props.perms.includes(Perms.PAIRED_WRITE)) { // check if write is allowed for this characteristic
        debug('[%s] Tried writing to Characteristic which does not allow writing (aid of %s and iid of %s)', this.displayName, data.aid, data.iid);
        return { status: HAPStatus.READ_ONLY_CHARACTERISTIC };
      }

      if (characteristic.props.adminOnlyAccess && characteristic.props.adminOnlyAccess.includes(Access.WRITE)) {
        let verifiable = true;
        if (!connection.username || !this._accessoryInfo) {
          verifiable = false;
          debug('[%s] Could not verify admin permissions for Characteristic which requires admin permissions for write (aid of %s and iid of %s)', this.displayName, data.aid, data.iid)
        }

        if (!verifiable || !this._accessoryInfo!.hasAdminPermissions(connection.username!)) {
          return { status: HAPStatus.INSUFFICIENT_PRIVILEGES };
        }
      }

      if (characteristic.props.perms.includes(Perms.ADDITIONAL_AUTHORIZATION) && characteristic.additionalAuthorizationHandler) {
        // if the characteristic "supports additional authorization" but doesn't define a handler for the check
        // we conclude that the characteristic doesn't want to check the authData (currently) and just allows access for everybody

        let allowWrite;
        try {
          allowWrite = characteristic.additionalAuthorizationHandler(data.authData);
        } catch (error) {
          console.log("[" + this.displayName + "] Additional authorization handler has thrown an error when checking authData: " + error.stack);
          allowWrite = false;
        }

        if (!allowWrite) {
          return { status: HAPStatus.INSUFFICIENT_AUTHORIZATION };
        }
      }

      if (characteristic.props.perms.includes(Perms.TIMED_WRITE) && writeState !== WriteRequestState.TIMED_WRITE_AUTHENTICATED) {
        debug('[%s] Tried writing to a timed write only Characteristic without properly preparing (iid of %s and aid of %s)', this.displayName, data.aid, data.iid);
        return { status: HAPStatus.INVALID_VALUE_IN_REQUEST };
      }

      return characteristic.handleSetRequest(data.value, connection).then(value => {
        debug('[%s] Setting Characteristic "%s" to value %s', this.displayName, characteristic.displayName, data.value);
        return {
          value: data.r && value? formatOutgoingCharacteristicValue(value, characteristic.props): undefined, // if write response is requests and value is provided, return that

          ev: evResponse,
        };
      }, (status: HAPStatus) => {
        // @ts-expect-error
        debug('[%s] Error setting Characteristic "%s" to value %s: ', this.displayName, characteristic.displayName, data.value, HAPStatus[status]);

        return { status: status };
      });
    } else {
      return { ev: evResponse };
    }
  }

  private handleResource(data: ResourceRequest, callback: ResourceRequestCallback): void {
    if (data["resource-type"] === ResourceRequestType.IMAGE) {
      const aid = data.aid; // aid is optionally supplied by HomeKit (for example when camera is bridged, multiple cams, etc)

      let accessory: Accessory | undefined = undefined;
      let controller: CameraController | undefined = undefined;
      if (aid) {
        accessory = this.getAccessoryByAID(aid);
        if (accessory && accessory.activeCameraController) {
          controller = accessory.activeCameraController;
        }
      } else if (this.activeCameraController) { // aid was not supplied, check if this accessory is a camera
        accessory = this;
        controller = this.activeCameraController;
      }

      if (!controller) {
        debug("[%s] received snapshot request though no camera controller was associated!");
        callback({ httpCode: HAPHTTPCode.NOT_FOUND, status: HAPStatus.RESOURCE_DOES_NOT_EXIST });
        return;
      }

      controller.handleSnapshotRequest(data["image-height"], data["image-width"], accessory?.displayName).then(buffer => {
        callback(undefined, buffer);
      }, (status: HAPStatus) => {
        callback({ httpCode: HAPHTTPCode.OK, status: status });
      });
      return;
    }

    debug("[%s] received request for unsupported image type: " + data["resource-type"], this._accessoryInfo?.username);
    callback({ httpCode: HAPHTTPCode.NOT_FOUND, status: HAPStatus.RESOURCE_DOES_NOT_EXIST});
  }

  private handleHAPConnectionClosed(connection: HAPConnection): void {
    if (this.activeCameraController) {
      this.activeCameraController.handleCloseConnection(connection.sessionID);
    }

    for (const event of connection.getRegisteredEvents()) {
      const ids = event.split(".");
      const aid = parseInt(ids[0], 10);
      const iid = parseInt(ids[1], 10);

      const characteristic = this.findCharacteristic(aid, iid);
      if (characteristic) {
        characteristic.unsubscribe();
      }
    }
    connection.clearRegisteredEvents();
  }

  private handleServiceConfigurationChangeEvent(service: Service): void {
    if (!service.isPrimaryService && service === this.primaryService) {
      // service changed form primary to non primary service
      this.primaryService = undefined;
    } else if (service.isPrimaryService && service !== this.primaryService) {
      // service changed from non primary to primary service
      if (this.primaryService !== undefined) {
        this.primaryService.isPrimaryService = false;
      }

      this.primaryService = service;
    }

    if (this.bridged) {
      this.emit(AccessoryEventTypes.SERVICE_CONFIGURATION_CHANGE, { service: service });
    } else {
      this.enqueueConfigurationUpdate();
    }
  }

  private handleCharacteristicChangeEvent(accessory: Accessory, service: Service, change: ServiceCharacteristicChange): void {
    if (this.bridged) { // forward this to our main accessory
      this.emit(AccessoryEventTypes.SERVICE_CHARACTERISTIC_CHANGE, { ...change, service: service });
    } else {
      if (!this._server) {
        return; // we're not running a HAPServer, so there's no one to notify about this event
      }

      if (accessory.aid == undefined || change.characteristic.iid == undefined) {
        debug("[%s] Muting event notification for %s as ids aren't yet assigned!", accessory.displayName, change.characteristic.displayName);
        return;
      }

      if (change.context != undefined && typeof change.context === "object" && (change.context as CharacteristicOperationContext).omitEventUpdate) {
        debug("[%s] Omitting event updates for %s as specified in the context object!", accessory.displayName, change.characteristic.displayName);
        return;
      }

      if (!(change.reason === ChangeReason.EVENT || change.oldValue !== change.newValue
        || change.characteristic.UUID === Characteristic.ProgrammableSwitchEvent.UUID // those specific checks are out of backwards compatibility
        || change.characteristic.UUID === Characteristic.ButtonEvent.UUID // new characteristics should use sendEventNotification call
      )) {
        // we only emit a change event if the reason was a call to sendEventNotification, if the value changed
        // as of a write request or a read request or if the change happened on dedicated event characteristics
        // otherwise we ignore this change event (with the return below)
        return;
      }

      const uuid = change.characteristic.UUID;
      const immediateDelivery = uuid === Characteristic.ButtonEvent.UUID || uuid === Characteristic.ProgrammableSwitchEvent.UUID
        || uuid === Characteristic.MotionDetected.UUID || uuid === Characteristic.ContactSensorState.UUID;

      const value = formatOutgoingCharacteristicValue(change.newValue, change.characteristic.props);
      this._server.sendEventNotifications(accessory.aid, change.characteristic.iid, value, change.originator, immediateDelivery);
    }
  }

  private sendCharacteristicWarning(characteristic: Characteristic, type: CharacteristicWarningType, message: string): void {
    this.handleCharacteristicWarning({
      characteristic: characteristic,
      type: type,
      message: message,
      originatorChain: [characteristic.displayName], // we are missing the service displayName, but that's okay
      stack: new Error().stack,
    });
  }

  private handleCharacteristicWarning(warning: CharacteristicWarning): void {
    warning.originatorChain = [this.displayName, ...warning.originatorChain];

    const emitted = this.emit(AccessoryEventTypes.CHARACTERISTIC_WARNING, warning);
    if (!emitted) {
      let message = `[${warning.originatorChain.join("@")}] ${warning.message}`

      if (warning.type === CharacteristicWarningType.ERROR_MESSAGE
        || warning.type === CharacteristicWarningType.TIMEOUT_READ|| warning.type === CharacteristicWarningType.TIMEOUT_WRITE) {
        console.error(message);
      } else {
        console.warn(message);
      }
      debug("[%s] Above characteristic warning was thrown at: %s", this.displayName, warning.stack ?? "unknown")
    }
  }

  private setupServiceEventHandlers(service: Service): void {
    service.on(ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE, this.handleServiceConfigurationChangeEvent.bind(this, service));
    service.on(ServiceEventTypes.CHARACTERISTIC_CHANGE, this.handleCharacteristicChangeEvent.bind(this, this, service));
    service.on(ServiceEventTypes.CHARACTERISTIC_WARNING, this.handleCharacteristicWarning.bind(this));
  }

  private _sideloadServices(targetServices: Service[]): void {
    for (const service of targetServices) {
      this.setupServiceEventHandlers(service);
    }

    this.services = targetServices.slice();

    // Fix Identify
    this
      .getService(Service.AccessoryInformation)!
      .getCharacteristic(Characteristic.Identify)!
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (value) {
          const paired = true;
          this.identificationRequest(paired, callback);
        }
      });
  }

  private static _generateSetupID(): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const max = chars.length;
    let setupID = '';

    for (let i = 0; i < 4; i++) {
      const index = Math.floor(Math.random() * max)
      setupID += chars.charAt(index);
    }

    return setupID;
  }

  // serialization and deserialization functions, mainly designed for homebridge to create a json copy to store on disk
  public static serialize(accessory: Accessory): SerializedAccessory {
    const json: SerializedAccessory = {
      displayName: accessory.displayName,
      UUID: accessory.UUID,
      lastKnownUsername: accessory._accessoryInfo? accessory._accessoryInfo.username: undefined,
      category: accessory.category,

      services: [],
    };

    const linkedServices: Record<ServiceId, ServiceId[]> = {};
    let hasLinkedServices = false;

    accessory.services.forEach(service => {
      json.services.push(Service.serialize(service));

      const linkedServicesPresentation: ServiceId[] = [];
      service.linkedServices.forEach(linkedService => {
        linkedServicesPresentation.push(linkedService.getServiceId());
      });
      if (linkedServicesPresentation.length > 0) {
        linkedServices[service.getServiceId()] = linkedServicesPresentation;
        hasLinkedServices = true;
      }
    });

    if (hasLinkedServices) {
      json.linkedServices = linkedServices;
    }

    const controllers: SerializedControllerContext[] = [];

    // save controllers
    Object.values(accessory.controllers).forEach((context: ControllerContext)  => {
      controllers.push({
        type: context.controller.controllerId(),
        services: Accessory.serializeServiceMap(context.serviceMap),
      });
    });

    // also save controller which didn't get initialized (could lead to service duplication if we throw that data away)
    accessory.serializedControllers && Object.entries(accessory.serializedControllers).forEach(([id, serviceMap]) => {
      controllers.push({
        type: id,
        services: Accessory.serializeServiceMap(serviceMap),
      });
    });

    if (controllers.length > 0) {
      json.controllers = controllers;
    }

    return json;
  }

  public static deserialize(json: SerializedAccessory): Accessory {
    const accessory = new Accessory(json.displayName, json.UUID);

    accessory.lastKnownUsername = json.lastKnownUsername;
    accessory.category = json.category;

    const services: Service[] = [];
    const servicesMap: Record<ServiceId, Service> = {};

    json.services.forEach(serialized => {
      const service = Service.deserialize(serialized);

      services.push(service);
      servicesMap[service.getServiceId()] = service;
    });

    if (json.linkedServices) {
      for (const [ serviceId, linkedServicesKeys ] of Object.entries(json.linkedServices)) {
        const primaryService = servicesMap[serviceId];

        if (!primaryService) {
          continue
        }

        linkedServicesKeys.forEach(linkedServiceKey => {
          const linkedService = servicesMap[linkedServiceKey];

          if (linkedService) {
            primaryService.addLinkedService(linkedService);
          }
        });
      }
    }

    if (json.controllers) { // just save it for later if it exists {@see configureController}
      accessory.serializedControllers = {};

      json.controllers.forEach(serializedController => {
        accessory.serializedControllers![serializedController.type] = Accessory.deserializeServiceMap(serializedController.services, servicesMap)
      });
    }

    accessory._sideloadServices(services);

    return accessory;
  }

  public static cleanupAccessoryData(username: MacAddress) {
    IdentifierCache.remove(username);
    AccessoryInfo.remove(username);
    ControllerStorage.remove(username);
  }

  private static serializeServiceMap(serviceMap: ControllerServiceMap): SerializedServiceMap {
    const serialized: SerializedServiceMap = {};

    Object.entries(serviceMap).forEach(([name, service]) => {
      if (!service) {
        return;
      }

      serialized[name] = service.getServiceId();
    });

    return serialized;
  }

  private static deserializeServiceMap(serializedServiceMap: SerializedServiceMap, servicesMap: Record<ServiceId, Service>): ControllerServiceMap {
    const controllerServiceMap: ControllerServiceMap = {};

    Object.entries(serializedServiceMap).forEach(([name, serviceId]) => {
      const service = servicesMap[serviceId];
      if (service) {
        controllerServiceMap[name] = service;
      }
    });

    return controllerServiceMap;
  }

  private static parseBindOption(info: PublishInfo): { advertiserAddress?: string[], serviceRestrictedAddress?: string[], serviceDisableIpv6?: boolean, serverAddress?: string } {
    let advertiserAddress: string[] | undefined = undefined;
    let disableIpv6 = false;
    let serverAddress: string | undefined = undefined;

    if (info.bind) {
      const entries: Set<InterfaceName | IPAddress> = new Set(Array.isArray(info.bind)? info.bind: [info.bind]);

      if (entries.has("::")) {
        serverAddress = "::"

        entries.delete("::");
        if (entries.size) {
          advertiserAddress = Array.from(entries);
        }
      } else if (entries.has("0.0.0.0")) {
        disableIpv6 = true;
        serverAddress = "0.0.0.0";

        entries.delete("0.0.0.0");
        if (entries.size) {
          advertiserAddress = Array.from(entries);
        }
      } else if (entries.size === 1) {
        advertiserAddress = Array.from(entries);

        const entry = entries.values().next().value; // grab the first one

        const version = net.isIP(entry); // check if ip address was specified or a interface name
        if (version) {
          serverAddress = version === 4? "0.0.0.0": "::"; // we currently bind to unspecified addresses so config-ui always has a connection via loopback
        } else {
          serverAddress = "::"; // the interface could have both ipv4 and ipv6 addresses
        }
      } else if (entries.size > 1) {
        advertiserAddress = Array.from(entries);

        let bindUnspecifiedIpv6 = false; // we bind on "::" if there are interface names, or we detect ipv6 addresses

        for (const entry of entries) {
          const version = net.isIP(entry);
          if (version === 0 || version === 6) {
            bindUnspecifiedIpv6 = true;
            break;
          }
        }

        if (bindUnspecifiedIpv6) {
          serverAddress = "::";
        } else {
          serverAddress = "0.0.0.0";
        }
      }
    }

    return {
      advertiserAddress: advertiserAddress,
      serviceRestrictedAddress: advertiserAddress,
      serviceDisableIpv6: disableIpv6,
      serverAddress: serverAddress,
    };
  }

}
