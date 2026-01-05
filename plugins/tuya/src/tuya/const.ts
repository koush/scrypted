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

export type TuyaDevice = {
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
  status: TuyaDeviceStatus[];
  schema: TuyaDeviceSchema[];

  // Not necessary?

  uid: string;
  biz_type: number;
  model?: string;
  owner_id: string;
}

export type TuyaDeviceSchema = {
  code: string;
  mode: "rw" | "r" | "w";
} & (
    {
      type: "Boolean";
      specs: never;
    } | {
      type: "Integer";
      specs: {
        unit?: string;
        min: number;
        max: number;
        scale: number;
        step: number;
      }
    } | {
      type: "Enum";
      specs: {
        range: string[]
      }
    } | {
      type: "String";
      specs: {
        maxlen: number
      };
    } | {
      type: "Json";
      specs: object;
    } | {
      type: "Raw";
      specs: any;
    }
  )

export type TuyaDeviceStatus = {
  code: string;
  value: string | number | boolean;
}

export type TuyaDeviceFunction = {
  code: string;
  type: string;
  name?: string;
  desc?: string;
  values: string;
}

export enum TuyaMessageProtocol {
  DEVICE = 4,
  OTHER = 30
}

export type TuyaMessage = {
  data: {
    dataId?: string;
  };
  protocol: number;
  pv?: string;
  sign?: string;
  t: number;
} & (
  {
    protocol: TuyaMessageProtocol.DEVICE;
    data: {
      devId: string;
      status: (TuyaDeviceStatus & { t: number })[]
    }
  } | {
    protocol: TuyaMessageProtocol.OTHER;
    data: {
      bizData: {
        devId: string;
        name?: string;
      };
      bizCode: "online" | "offline" | "nameUpdate" | "dpNameUpdate" | "bindUser" | "delete";
    }
  }
)

export type RTSPToken = {
  url: string;
  expires: number;
}