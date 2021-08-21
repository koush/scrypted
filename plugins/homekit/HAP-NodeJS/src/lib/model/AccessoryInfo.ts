import assert from 'assert';
import crypto from "crypto";
import tweetnacl from 'tweetnacl';
import util from 'util';
import { AccessoryJsonObject } from "../../internal-types";
import { MacAddress } from "../../types";
import { Categories } from '../Accessory';
import { EventedHTTPServer, HAPConnection, HAPUsername } from "../util/eventedhttp";
import { HAPStorage } from "./HAPStorage";


const packageJson = require("../../../package.json");

export const enum PermissionTypes {
  // noinspection JSUnusedGlobalSymbols
  USER = 0x00,
  ADMIN = 0x01, // admins are the only ones who can add/remove/list pairings (additionally some characteristics are restricted)
}

export type PairingInformation = {
  username: HAPUsername,
  publicKey: Buffer,
  permission: PermissionTypes,
}

/**
 * AccessoryInfo is a model class containing a subset of Accessory data relevant to the internal HAP server,
 * such as encryption keys and username. It is persisted to disk.
 */
export class AccessoryInfo {

  static readonly deviceIdPattern: RegExp = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  username: MacAddress;
  displayName: string;
  model: string; // this property is currently not saved to disk
  category: Categories;
  pincode: string;
  signSk: Buffer;
  signPk: Buffer;
  pairedClients: Record<HAPUsername, PairingInformation>;
  pairedAdminClients: number;
  private configVersion: number = 1;
  private configHash: string;
  setupID: string;
  private lastFirmwareVersion: string = "";

  private constructor(username: MacAddress) {
    this.username = username;
    this.displayName = "";
    this.model = "";
    // @ts-ignore
    this.category = "";
    this.pincode = "";
    this.signSk = Buffer.alloc(0);
    this.signPk = Buffer.alloc(0);
    this.pairedClients = {};
    this.pairedAdminClients = 0;
    this.configHash = "";

    this.setupID = "";
  }

  /**
   * Add a paired client to memory.
   * @param {HAPUsername} username
   * @param {Buffer} publicKey
   * @param {PermissionTypes} permission
   */
  public addPairedClient(username: HAPUsername, publicKey: Buffer, permission: PermissionTypes): void {
    this.pairedClients[username] = {
      username: username,
      publicKey: publicKey,
      permission: permission
    };

    if (permission === PermissionTypes.ADMIN) {
      this.pairedAdminClients++;
    }
  }

  public updatePermission(username: HAPUsername, permission: PermissionTypes): void {
    const pairingInformation = this.pairedClients[username];

    if (pairingInformation) {
      const oldPermission = pairingInformation.permission;
      pairingInformation.permission = permission;

      if (oldPermission === PermissionTypes.ADMIN && permission !== PermissionTypes.ADMIN) {
        this.pairedAdminClients--;
      } else if (oldPermission !== PermissionTypes.ADMIN && permission === PermissionTypes.ADMIN) {
        this.pairedAdminClients++;
      }
    }
  }

  public listPairings(): PairingInformation[] {
    const array: PairingInformation[] = [];

    for (const pairingInformation of Object.values(this.pairedClients)) {
      array.push(pairingInformation);
    }

    return array;
  }

  /**
   * Remove a paired client from memory.
   * @param connection - the session of the connection initiated the removal of the pairing
   * @param {string} username
   */
  public removePairedClient(connection: HAPConnection, username: HAPUsername): void {
    this._removePairedClient0(connection, username);

    if (this.pairedAdminClients === 0) { // if we don't have any admin clients left paired it is required to kill all normal clients
      for (const username0 of Object.keys(this.pairedClients)) {
        this._removePairedClient0(connection, username0);
      }
    }
  }

  private _removePairedClient0(connection: HAPConnection, username: HAPUsername): void {
    if (this.pairedClients[username] && this.pairedClients[username].permission === PermissionTypes.ADMIN)
      this.pairedAdminClients--;
    delete this.pairedClients[username];

    EventedHTTPServer.destroyExistingConnectionsAfterUnpair(connection, username);
  }

  /**
   * Check if username is paired
   * @param username
   */
  public isPaired(username: HAPUsername): boolean {
    return !!this.pairedClients[username];
  }

  public hasAdminPermissions(username: HAPUsername): boolean {
    if (!username) return false;
    const pairingInformation = this.pairedClients[username];
    return !!pairingInformation && pairingInformation.permission === PermissionTypes.ADMIN;
  }

  // Gets the public key for a paired client as a Buffer, or falsy value if not paired.
  public getClientPublicKey(username: HAPUsername): Buffer | undefined {
    const pairingInformation = this.pairedClients[username];
    if (pairingInformation) {
      return pairingInformation.publicKey;
    } else {
      return undefined;
    }
  }

  // Returns a boolean indicating whether this accessory has been paired with a client.
  paired = (): boolean => {
    return Object.keys(this.pairedClients).length > 0; // if we have any paired clients, we're paired.
  }

  /**
   * Checks based on the current accessory configuration if the current configuration number needs to be incremented.
   * Additionally, if desired, it checks if the firmware version was incremented (aka the HAP-NodeJS) version did grow.
   *
   * @param configuration - The current accessory configuration.
   * @param checkFirmwareIncrement
   * @returns True if the current configuration number was incremented and thus a new TXT must be advertised.
   */
  public checkForCurrentConfigurationNumberIncrement(configuration: AccessoryJsonObject[], checkFirmwareIncrement?: boolean): boolean {
    const shasum = crypto.createHash('sha1');
    shasum.update(JSON.stringify(configuration));
    const configHash = shasum.digest('hex');

    let changed = false;

    if (configHash !== this.configHash) {
      this.configVersion++;
      this.configHash = configHash;

      this.ensureConfigVersionBounds();
      changed = true;
    }
    if (this.lastFirmwareVersion !== packageJson.version) {
      // we only check if it is different and not only if it is incremented
      // HomeKit spec prohibits firmware downgrades, but with hap-nodejs it's possible lol
      this.lastFirmwareVersion = packageJson.version;
      changed = true;
    }

    if (changed) {
      this.save();
    }

    return changed;
  }

  public getConfigVersion(): number {
    return this.configVersion;
  }

  private ensureConfigVersionBounds(): void {
    // current configuration number must be in the range of 1-65535 and wrap to 1 when it overflows

    this.configVersion = this.configVersion % (0xFFFF + 1);
    if (this.configVersion === 0) {
      this.configVersion = 1;
    }
  }

  save = () => {
    const saved = {
      displayName: this.displayName,
      category: this.category,
      pincode: this.pincode,
      signSk: this.signSk.toString('hex'),
      signPk: this.signPk.toString('hex'),
      pairedClients: {},
      // moving permissions into an extra object, so there is nothing to migrate from old files.
      // if the legacy node-persist storage should be upgraded some time, it would be reasonable to combine the storage
      // of public keys (pairedClients object) and permissions.
      pairedClientsPermission: {},
      configVersion: this.configVersion,
      configHash: this.configHash,
      setupID: this.setupID,
      lastFirmwareVersion: this.lastFirmwareVersion,
    };

    for (const [ username, pairingInformation ] of Object.entries(this.pairedClients)) {
      //@ts-ignore
      saved.pairedClients[username] = pairingInformation.publicKey.toString("hex");
      // @ts-ignore
      saved.pairedClientsPermission[username] = pairingInformation.permission;
    }

    const key = AccessoryInfo.persistKey(this.username);

    HAPStorage.storage().setItemSync(key, saved);
  }

// Gets a key for storing this AccessoryInfo in the filesystem, like "AccessoryInfo.CC223DE3CEF3.json"
  static persistKey = (username: MacAddress) => {
    return util.format("AccessoryInfo.%s.json", username.replace(/:/g, "").toUpperCase());
  }

  static create = (username: MacAddress) => {
    AccessoryInfo.assertValidUsername(username);
    const accessoryInfo = new AccessoryInfo(username);

    accessoryInfo.lastFirmwareVersion = packageJson.version;

    // Create a new unique key pair for this accessory.
    const keyPair = tweetnacl.sign.keyPair();

    accessoryInfo.signSk = Buffer.from(keyPair.secretKey);
    accessoryInfo.signPk = Buffer.from(keyPair.publicKey);

    return accessoryInfo;
  }

  static load = (username: MacAddress) => {
    AccessoryInfo.assertValidUsername(username);

    const key = AccessoryInfo.persistKey(username);
    const saved = HAPStorage.storage().getItem(key);

    if (saved) {
      const info = new AccessoryInfo(username);
      info.displayName = saved.displayName || "";
      info.category = saved.category || "";
      info.pincode = saved.pincode || "";
      info.signSk = Buffer.from(saved.signSk || '', 'hex');
      info.signPk = Buffer.from(saved.signPk || '', 'hex');

      info.pairedClients = {};
      for (const username of Object.keys(saved.pairedClients || {})) {
        const publicKey = saved.pairedClients[username];
        let permission = saved.pairedClientsPermission? saved.pairedClientsPermission[username]: undefined;
        if (permission === undefined)
          permission = PermissionTypes.ADMIN; // defaulting to admin permissions is the only suitable solution, there is no way to recover permissions

        info.pairedClients[username] = {
          username: username,
          publicKey: Buffer.from(publicKey, 'hex'),
          permission: permission
        };
        if (permission === PermissionTypes.ADMIN)
          info.pairedAdminClients++;
      }

      info.configVersion = saved.configVersion || 1;
      info.configHash = saved.configHash || "";

      info.setupID = saved.setupID || "";

      info.lastFirmwareVersion = saved.lastFirmwareVersion || packageJson.version;

      info.ensureConfigVersionBounds();

      return info;
    } else {
      return null;
    }
  }

  static remove(username: MacAddress) {
    const key = AccessoryInfo.persistKey(username);
    HAPStorage.storage().removeItemSync(key);
  }

  static assertValidUsername = (username: MacAddress) => {
    assert.ok(AccessoryInfo.deviceIdPattern.test(username),
        "The supplied username (" + username + ") is not valid " +
        "(expected a format like 'XX:XX:XX:XX:XX:XX' with XX being a valid hexadecimal string). " +
        "Note that, if you had this accessory already paired with the invalid username, you will need to repair " +
        "the accessory and reconfigure your services in the Home app. " +
        "Using an invalid username will lead to unexpected behaviour.")
  };

}

