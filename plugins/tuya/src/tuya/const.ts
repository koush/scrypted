import { type } from "os";

export interface TuyaResponse<T> {
    success: boolean
    t: number
    result: T
}

export interface TuyaDeviceConfig {
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
    functions: DeviceFunction[];

    // Not necessary?

    uid: string;
    biz_type: number;
    model: string;
    owner_id: string;
}

export interface TuyaDeviceStatus {
    code: string;
    value: any;
}

export interface DeviceFunction {
    code: string;
    type: string;
    values: string;
    desc: string;
    name: string;
}

export interface RTSPToken {
    url: string;
    expires: Date;
}

export interface MQTTConfig {
    url: string;
    client_id: string;
    username: string;
    password: string;
    source_topic: string;
    sink_topic: string;
    expire_topic: string;
}

// From Unify Protect Api:
// This type declaration make all properties optional recursively including nested objects. This should
// only be used on JSON objects only. Otherwise...you're going to end up with class methods marked as
// optional as well. Credit for this belongs to: https://github.com/joonhocho/tsdef. #Grateful
// export type DeepPartial<T> = {
//     [P in keyof T]?: T[P] extends Array<infer I> ? Array<DeepPartial<I>> : DeepPartial<T[P]>
// };

// export type ProtectTuyaDeviceConfig = Readonly<TuyaDeviceInterface>;
// export type ProtectTuyaDeviceConfigPartial = DeepPartial<TuyaDeviceInterface>;
// export type ProtectTuyaDeviceStatus = Readonly<TuyaDeviceStatus>;
