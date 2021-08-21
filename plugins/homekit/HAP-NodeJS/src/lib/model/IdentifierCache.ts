import crypto from 'crypto';
import util from 'util';
import { MacAddress } from "../../types";
import { HAPStorage } from "./HAPStorage";

/**
 * IdentifierCache is a model class that manages a system of associating HAP "Accessory IDs" and "Instance IDs"
 * with other values that don't usually change. HomeKit Clients use Accessory/Instance IDs as a primary key of
 * sorts, so the IDs need to remain "stable". For instance, if you create a HomeKit "Scene" called "Leaving Home"
 * that sets your Alarm System's "Target Alarm State" Characteristic to "Arm Away", that Scene will store whatever
 * "Instance ID" it was given for the "Target Alarm State" Characteristic. If the ID changes later on this server,
 * the scene will stop working.
 */
export class IdentifierCache {


  _cache: Record<string, number> = {}; // cache[key:string] = id:number
  _usedCache: Record<string, number> | null = null; // for usage tracking and expiring old keys
  _savedCacheHash: string = ""; // for checking if new cache need to be saved

  constructor(public username: MacAddress) {
  }

  startTrackingUsage = () => {
    this._usedCache = {};
  }

  stopTrackingUsageAndExpireUnused = () => {
    // simply rotate in the new cache that was built during our normal getXYZ() calls.
    this._cache = this._usedCache || this._cache;
    this._usedCache = null;
  }

  getCache = (key: string) => {
    const value = this._cache[key];
    // track this cache item if needed
    if (this._usedCache && typeof value !== 'undefined')
      this._usedCache[key] = value;
    return value;
  }

  setCache = (key: string, value: number) => {
    this._cache[key] = value;
    // track this cache item if needed
    if (this._usedCache)
      this._usedCache[key] = value;
    return value;
  }

  getAID = (accessoryUUID: string) => {
    const key = accessoryUUID;
    // ensure that our "next AID" field is not expired
    this.getCache('|nextAID');
    return this.getCache(key) || this.setCache(key, this.getNextAID());
  }

  getIID = (accessoryUUID: string, serviceUUID: string, serviceSubtype?: string, characteristicUUID?: string) => {
    const key = accessoryUUID
      + '|' + serviceUUID
      + (serviceSubtype ? '|' + serviceSubtype : '')
      + (characteristicUUID ? '|' + characteristicUUID : '');
    // ensure that our "next IID" field for this accessory is not expired
    this.getCache(accessoryUUID + '|nextIID');
    return this.getCache(key) || this.setCache(key, this.getNextIID(accessoryUUID));
  }

  getNextAID = () => {
    const key = '|nextAID';
    const nextAID = this.getCache(key) || 2; // start at 2 because the root Accessory or Bridge must be 1
    this.setCache(key, nextAID + 1); // increment
    return nextAID;
  }

  getNextIID = (accessoryUUID: string) => {
    const key = accessoryUUID + '|nextIID';
    const nextIID = this.getCache(key) || 2; // iid 1 is reserved for the Accessory Information service
    this.setCache(key, nextIID + 1); // increment
    return nextIID;
  }

  save = () => {
    const newCacheHash = crypto.createHash('sha1').update(JSON.stringify(this._cache)).digest('hex'); //calculate hash of new cache
    if (newCacheHash != this._savedCacheHash) { //check if cache need to be saved and proceed accordingly
      const saved = {
        cache: this._cache
      };
      const key = IdentifierCache.persistKey(this.username);
      HAPStorage.storage().setItemSync(key, saved);
      this._savedCacheHash = newCacheHash; //update hash of saved cache for future use
    }
  }

  /**
   * Persisting to File System
   */
  // Gets a key for storing this IdentifierCache in the filesystem, like "IdentifierCache.CC223DE3CEF3.json"
  static persistKey = (username: MacAddress) => {
    return util.format("IdentifierCache.%s.json", username.replace(/:/g, "").toUpperCase());
  }

  static load = (username: MacAddress) => {
    const key = IdentifierCache.persistKey(username);
    const saved = HAPStorage.storage().getItem(key);
    if (saved) {
      const info = new IdentifierCache(username);
      info._cache = saved.cache;
      info._savedCacheHash = crypto.createHash('sha1').update(JSON.stringify(info._cache)).digest('hex'); //calculate hash of the saved hash to decide in future if saving of new cache is needed
      return info;
    } else {
      return null;
    }
  }

  static remove(username: MacAddress) {
    const key = this.persistKey(username);
    HAPStorage.storage().removeItemSync(key);
  }

}













