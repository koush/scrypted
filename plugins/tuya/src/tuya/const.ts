import { TuyaCloudTokenInfo } from "./cloud";
import { TuyaSharingTokenInfo } from "./sharing";

export enum TuyaLoginMethod {
  App = "Tuya (Smart Life) App",
  Account = "Tuya Developer Account"
}

export type TuyaTokenInfo = (TuyaSharingTokenInfo & { type: TuyaLoginMethod.App }) | (TuyaCloudTokenInfo & { type: TuyaLoginMethod.Account });

export type TuyaResponse<T> = {
  success?: boolean;
  t?: number;
  result: T;
  tid?: string;
}

export type TuyaDeviceConfig = {
  id: string;
  name: string;
  local_key: string;
  category: string;
  product_id: string;
  product_name: string;
  sub: boolean;
  uuid: string;
  online: boolean;
  icon: string;
  ip: string;
  time_zone: string;
  active_time: number;
  create_time: number;
  update_time: number;
  status: { [key: string]: TuyaDeviceStatus };
  functions: { [key: string]: TuyaDeviceFunction };
  status_range: { [key: string]: TuyaDeviceStatusRange }

  // Not necessary?

  uid: string;
  biz_type: number;
  model: string;
  owner_id: string;
}

export type TuyaDeviceStatus = {
  code: string;
  value: any;
}

export type TuyaDeviceStatusRange = {
  code: string;
  type: string;
  values: string;
}

export type TuyaDeviceFunction = {
  code: string;
  type: string;
  name: string;
  desc: string;
  values: { [key: string]: any };
}

export type RTSPToken = {
  url: string;
  expires: number;
}

export type MQTTConfig = {
  url: string;
  username: string;
  password: string;
  client_id: string;
  source_topic: string;
  sink_topic: string;
  expire_time: number;
}