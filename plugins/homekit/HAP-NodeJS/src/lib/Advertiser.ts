/// <reference path="../../@types/bonjour-hap.d.ts" />
import ciao, {
  CiaoService,
  MDNSServerOptions,
  Responder,
  ServiceEvent,
  ServiceTxt,
  ServiceType
} from "@homebridge/ciao";
import { InterfaceName, IPAddress } from "@homebridge/ciao/lib/NetworkManager";
import assert from "assert";
import bonjour, { BonjourHAP, BonjourHAPService, MulticastOptions } from "bonjour-hap";
import crypto from 'crypto';
import { EventEmitter } from "events";
import { AccessoryInfo } from './model/AccessoryInfo';

/**
 * This enum lists all bitmasks for all known status flags.
 * When the bit for the given bitmask is set, it represents the state described by the name.
 */
export const enum StatusFlag {
  NOT_PAIRED = 0x01,
  NOT_JOINED_WIFI = 0x02,
  PROBLEM_DETECTED = 0x04,
}

/**
 * This enum lists all bitmasks for all known pairing feature flags.
 * When the bit for the given bitmask is set, it represents the state described by the name.
 */
export const enum PairingFeatureFlag {
  SUPPORTS_HARDWARE_AUTHENTICATION = 0x01,
  SUPPORTS_SOFTWARE_AUTHENTICATION = 0x02,
}

export const enum AdvertiserEvent {
  UPDATED_NAME = "updated-name",
}

export declare interface Advertiser {
  on(event: "updated-name", listener: (name: string) => void): this;

  emit(event: "updated-name", name: string): boolean;
}

export interface ServiceNetworkOptions {
  /**
   * If defined it restricts the service to be advertised on the specified
   * ip addresses or interface names.
   *
   * If a interface name is specified, ANY address on that given interface will be advertised
   * (if a IP address of the given interface is also given in the array, it will be overridden).
   * If a IP address is specified, the service will only be advertised for the given addresses.
   *
   * Interface names and addresses can be mixed in the array.
   * If an ip address is given, the ip address must be valid at the time of service creation.
   *
   * If the service is set to advertise on a given interface, though the MDNSServer is
   * configured to ignore this interface, the service won't be advertised on the interface.
   */
  restrictedAddresses?: (InterfaceName | IPAddress)[];
  /**
   * The service won't advertise ipv6 address records.
   * This can be used to simulate binding on 0.0.0.0.
   * May be combined with {@link restrictedAddresses}.
   */
  disabledIpv6?: boolean;
}

export interface Advertiser {

  initPort(port: number): void;

  startAdvertising(): void;

  updateAdvertisement(silent?: boolean): void;

  destroy(): void;

}

/**
 * Advertiser uses mdns to broadcast the presence of an Accessory to the local network.
 *
 * Note that as of iOS 9, an accessory can only pair with a single client. Instead of pairing your
 * accessories with multiple iOS devices in your home, Apple intends for you to use Home Sharing.
 * To support this requirement, we provide the ability to be "discoverable" or not (via a "service flag" on the
 * mdns payload).
 */
export class CiaoAdvertiser extends EventEmitter implements Advertiser {

  static protocolVersion: string = "1.1";
  static protocolVersionService: string = "1.1.0";

  private readonly accessoryInfo: AccessoryInfo;
  private readonly setupHash: string;

  private readonly responder: Responder;
  private readonly advertisedService: CiaoService;

  constructor(accessoryInfo: AccessoryInfo, responderOptions?: MDNSServerOptions, serviceOptions?: ServiceNetworkOptions) {
    super();
    this.accessoryInfo = accessoryInfo;
    this.setupHash = CiaoAdvertiser.computeSetupHash(accessoryInfo);

    this.responder = ciao.getResponder({
      ...responderOptions
    });
    this.advertisedService = this.responder.createService({
      name: this.accessoryInfo.displayName,
      type: ServiceType.HAP,
      txt: CiaoAdvertiser.createTxt(accessoryInfo, this.setupHash),
      // host will default now to <displayName>.local, spaces replaced with dashes
      ...serviceOptions,
    });
    this.advertisedService.on(ServiceEvent.NAME_CHANGED, this.emit.bind(this, AdvertiserEvent.UPDATED_NAME));

    console.log(`Preparing Advertiser for '${this.accessoryInfo.displayName}' using ciao backend!`);
  }

  public initPort(port: number): void {
    this.advertisedService.updatePort(port);
  }

  public startAdvertising(): Promise<void> {
    console.log(`Starting to advertise '${this.accessoryInfo.displayName}' using ciao backend!`);
    return this.advertisedService!.advertise();
  }

  public updateAdvertisement(silent?: boolean): void {
    this.advertisedService!.updateTxt(CiaoAdvertiser.createTxt(this.accessoryInfo, this.setupHash), silent);
  }

  public async destroy(): Promise<void> {
    await this.advertisedService!.destroy();
    await this.responder.shutdown();
    this.removeAllListeners();
  }

  static createTxt(accessoryInfo: AccessoryInfo, setupHash: string): ServiceTxt {
    const statusFlags: StatusFlag[] = [];

    if (!accessoryInfo.paired()) {
      statusFlags.push(StatusFlag.NOT_PAIRED);
    }

    return {
      "c#": accessoryInfo.getConfigVersion(), // current configuration number
      ff: CiaoAdvertiser.ff(), // pairing feature flags
      id: accessoryInfo.username, // device id
      md: accessoryInfo.model, // model name
      pv: CiaoAdvertiser.protocolVersion, // protocol version
      "s#": 1, // current state number (must be 1)
      sf: CiaoAdvertiser.sf(...statusFlags), // status flags
      ci: accessoryInfo.category,
      sh: setupHash,
    };
  }

  static computeSetupHash(accessoryInfo: AccessoryInfo): string {
    const hash = crypto.createHash('sha512');
    hash.update(accessoryInfo.setupID + accessoryInfo.username.toUpperCase());
    return hash.digest().slice(0, 4).toString('base64');
  }

  public static ff(...flags: PairingFeatureFlag[]): number {
    let value = 0;
    flags.forEach(flag => value |= flag);
    return value;
  }

  public static sf(...flags: StatusFlag[]): number {
    let value = 0;
    flags.forEach(flag => value |= flag);
    return value;
  }

}

/**
 * Advertiser base on the legacy "bonjour-hap" library.
 */
export class BonjourHAPAdvertiser extends EventEmitter implements Advertiser {

  private readonly accessoryInfo: AccessoryInfo;
  private readonly setupHash: string;
  private readonly serviceOptions?: ServiceNetworkOptions;

  private bonjour: BonjourHAP;
  private advertisement?: BonjourHAPService;

  private port?: number;
  private destroyed: boolean = false;

  constructor(accessoryInfo: AccessoryInfo, responderOptions?: MulticastOptions, serviceOptions?: ServiceNetworkOptions) {
    super();
    this.accessoryInfo = accessoryInfo;
    this.setupHash = CiaoAdvertiser.computeSetupHash(accessoryInfo);
    this.serviceOptions = serviceOptions;

    this.bonjour = bonjour(responderOptions);
    console.log(`Preparing Advertiser for '${this.accessoryInfo.displayName}' using bonjour-hap backend!`);
  }

  public initPort(port: number): void {
    this.port = port;
  }

  public startAdvertising(): void {
    assert(!this.destroyed, "Can't advertise on a destroyed bonjour instance!");
    if (this.port == undefined) {
      throw new Error("Tried starting bonjour-hap advertisement without initializing port!");
    }

    console.log(`Starting to advertise '${this.accessoryInfo.displayName}' using bonjour-hap backend!`);

    if (this.advertisement) {
      this.destroy();
    }

    const hostname = this.accessoryInfo.username.replace(/:/ig, "_") + '.local';

    this.advertisement = this.bonjour.publish({
      name: this.accessoryInfo.displayName,
      type: "hap",
      port: this.port,
      txt: CiaoAdvertiser.createTxt(this.accessoryInfo, this.setupHash),
      host: hostname,
      addUnsafeServiceEnumerationRecord: true,
      ...this.serviceOptions,
    });
  }

  public updateAdvertisement(silent?: boolean): void {
    if (this.advertisement) {
      this.advertisement.updateTxt(CiaoAdvertiser.createTxt(this.accessoryInfo, this.setupHash), silent);
    }
  }

  public destroy(): void {
    if (this.advertisement) {
      this.advertisement.stop(() => {
        this.advertisement!.destroy();
        this.advertisement = undefined;
        this.bonjour.destroy();
      });
    } else {
      this.bonjour.destroy();
    }
  }

}

