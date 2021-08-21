declare module 'bonjour-hap' {

  export const enum Protocols {
    TCP = 'tcp',
    UDP = 'udp',
  }

  export type Nullable<T> = T | null;
  export type TxtRecord = Record<string, string>;

  export class BonjourHAPService {
    name: string;
    type: string;
    subtypes: Nullable<string[]>;
    protocol: Protocols;
    host: string;
    port: number;
    fqdn: string;
    txt: Nullable<Record<string, string>>;
    published: boolean;

    start(): void;
    stop(callback?: () => void): void;
    destroy(): void;
    updateTxt(txt: TxtRecord, silent?: boolean): void;
  }

  export type PublishOptions = {
    category?: any,
    host?: string;
    name?: string;
    pincode?: string;
    port: number;
    protocol?: Protocols;
    subtypes?: string[];
    txt?: Record<string, string>;
    type?: string;
    username?: string;

    addUnsafeServiceEnumerationRecord?: boolean,

    restrictedAddresses?: string[];
    disabledIpv6?: boolean;
  };

  export class BonjourHAP {
    publish(options: PublishOptions): BonjourHAPService;
    unpublishAll(callback: () => void): void;
    destroy(): void;
  }


  export type MulticastOptions = {
    multicast?: boolean;
    interface?: string;
    port?: number;
    ip?: string;
    ttl?: number;
    loopback?: boolean;
    reuseAddr?: boolean;
  };
  function createWithOptions(options?: MulticastOptions): BonjourHAP;

  export default createWithOptions;
}
