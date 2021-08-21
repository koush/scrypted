import { Formats, Perms, Units } from "./lib/Characteristic";
import { HAPStatus } from "./lib/HAPServer";
import { CharacteristicValue, Nullable } from "./types";

/*
type HAPProps = Pick<CharacteristicProps, 'perms' | 'format' | 'description' | 'unit' | 'maxValue' | 'minValue' | 'minStep' | 'maxLen'>
  & {
  "valid-values"?: number[],
  "valid-values-range"?: [number, number],
}
export type HapCharacteristic = HAPProps & {
  iid: number;
  type: string;
  value: string | number | {} | null;
}
export type HapService = {
  iid: number;
  type: string;

  characteristics: HapCharacteristic[];
  primary: boolean;
  hidden: boolean;
  linked: number[];
}
 */
export interface CharacteristicJsonObject {
  type: string, // uuid or short uuid
  iid: number,
  value?: Nullable<CharacteristicValue>, // undefined for non readable characteristics

  perms: Perms[],
  format: Formats | string,

  description?: string,

  unit?: Units | string,
  minValue?: number,
  maxValue?: number,
  minStep?: number,
  maxLen?: number,
  maxDataLen?: number,
  "valid-values"?: number[],
  "valid-values-range"?: [min: number, max: number],
}

export interface ServiceJsonObject {
  type: string,
  iid: number,
  characteristics: CharacteristicJsonObject[], // must not be empty, max 100 characteristics
  hidden?: boolean,
  primary?: boolean,
  linked?: number[], // iid array
}

export interface AccessoryJsonObject {
  aid: number,
  services: ServiceJsonObject[], // must not be empty, max 100 services
}

export interface AccessoriesResponse {
  accessories: AccessoryJsonObject[],
}

export interface CharacteristicId {
  aid: number,
  iid: number,
}

export interface CharacteristicsReadRequest {
  ids: CharacteristicId[],
  includeMeta: boolean;
  includePerms: boolean,
  includeType: boolean,
  includeEvent: boolean,
}

export interface PartialCharacteristicReadDataValue {
  value: CharacteristicValue | null,

  status?: HAPStatus.SUCCESS,

  // type
  type?: string, // characteristics uuid

  // metadata
  format?: string,
  unit?: string,
  minValue?: number,
  maxValue?: number,
  minStep?: number,
  maxLen?: number,

  // perms
  perms?: Perms[],

  // event
  ev?: boolean,
}

export interface PartialCharacteristicReadError {
  status: HAPStatus,
}

export interface CharacteristicReadDataValue extends PartialCharacteristicReadDataValue {
  aid: number,
  iid: number,
}

export interface CharacteristicReadError extends PartialCharacteristicReadError {
  aid: number,
  iid: number,
}

export type PartialCharacteristicReadData = PartialCharacteristicReadDataValue | PartialCharacteristicReadError;
export type CharacteristicReadData = CharacteristicReadDataValue | CharacteristicReadError;

export interface CharacteristicsReadResponse {
  characteristics: CharacteristicReadData[],
}

export interface CharacteristicWrite {
  aid: number,
  iid: number,

  value?: CharacteristicValue,
  ev?: boolean, // enable/disable event notifications for the accessory

  authData?: string, // base64 encoded string used for custom authorisation
  /**
   * @deprecated This indicated if access was done via the old iCloud relay
   */
  remote?: boolean, // remote access used
  r?: boolean, // write response
}

export interface CharacteristicsWriteRequest {
  characteristics: CharacteristicWrite[],
  pid?: number
}

export interface PartialCharacteristicWriteDataValue {
  value?: CharacteristicValue | null,
  ev?: boolean, // event

  status?: HAPStatus.SUCCESS,
}

export interface PartialCharacteristicWriteError {
  status: HAPStatus,

  value?: undefined, // defined to make things easier
}

export interface CharacteristicWriteDataValue extends PartialCharacteristicWriteDataValue{
  aid: number,
  iid: number,
}

export interface CharacteristicWriteError extends PartialCharacteristicWriteError {
  aid: number,
  iid: number,
}

export type PartialCharacteristicWriteData = PartialCharacteristicWriteDataValue | PartialCharacteristicWriteError;
export type CharacteristicWriteData = CharacteristicWriteDataValue | CharacteristicWriteError;

export interface CharacteristicsWriteResponse {
  characteristics: CharacteristicWriteData[],
}

export type PrepareWriteRequest = {
  ttl: number,
  pid: number
}

export const enum ResourceRequestType {
  IMAGE = "image",
}

export interface ResourceRequest {
  aid?: number;
  "image-height": number;
  "image-width": number;
  "resource-type": ResourceRequestType;
}

export interface EventNotification {
  characteristics: CharacteristicEventNotification[],
}

export interface CharacteristicEventNotification {
  aid: number,
  iid: number,
  value: Nullable<CharacteristicValue>,
}

export function consideredTrue(input: string | null): boolean {
  if (!input) {
    return false;
  }

  return input === "true" || input === "1";
}
