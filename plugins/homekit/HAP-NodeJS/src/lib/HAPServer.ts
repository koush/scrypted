import crypto from 'crypto';
import createDebug from 'debug';
import { EventEmitter } from "events";
import { SRP, SrpServer } from "fast-srp-hap";
import { IncomingMessage, ServerResponse } from "http";
import tweetnacl from 'tweetnacl';
import { URL } from 'url';
import {
  AccessoriesResponse,
  CharacteristicId,
  CharacteristicsReadRequest,
  CharacteristicsReadResponse,
  CharacteristicsWriteRequest,
  CharacteristicsWriteResponse,
  consideredTrue,
  PrepareWriteRequest,
  ResourceRequest
} from "../internal-types";
import { CharacteristicValue, Nullable, VoidCallback } from '../types';
import { AccessoryInfo, PairingInformation, PermissionTypes } from "./model/AccessoryInfo";
import {
  EventedHTTPServer,
  EventedHTTPServerEvent,
  HAPConnection,
  HAPEncryption,
  HAPUsername
} from './util/eventedhttp';
import * as hapCrypto from './util/hapCrypto';
import { once } from './util/once';
import * as tlv from './util/tlv';

const debug = createDebug('HAP-NodeJS:HAPServer');

const enum TLVValues {
  // noinspection JSUnusedGlobalSymbols
  REQUEST_TYPE = 0x00,
  METHOD = 0x00, // (match the terminology of the spec sheet but keep backwards compatibility with entry above)
  USERNAME = 0x01,
  IDENTIFIER = 0x01,
  SALT = 0x02,
  PUBLIC_KEY = 0x03,
  PASSWORD_PROOF = 0x04,
  ENCRYPTED_DATA = 0x05,
  SEQUENCE_NUM = 0x06,
  STATE = 0x06,
  ERROR_CODE = 0x07,
  RETRY_DELAY = 0x08,
  CERTIFICATE = 0x09, // x.509 certificate
  PROOF = 0x0A,
  SIGNATURE = 0x0A,  // apple authentication coprocessor
  PERMISSIONS = 0x0B, // None (0x00): regular user, 0x01: Admin (able to add/remove/list pairings)
  FRAGMENT_DATA = 0x0C,
  FRAGMENT_LAST = 0x0D,
  SEPARATOR = 0x0FF // Zero-length TLV that separates different TLVs in a list.
}

const enum PairMethods {
  // noinspection JSUnusedGlobalSymbols
  PAIR_SETUP = 0x00,
  PAIR_SETUP_WITH_AUTH = 0x01,
  PAIR_VERIFY = 0x02,
  ADD_PAIRING = 0x03,
  REMOVE_PAIRING = 0x04,
  LIST_PAIRINGS = 0x05
}

/**
 * Pairing states (pair-setup or pair-verify). Encoded in {@link TLVValues.SEQUENCE_NUM}.
 */
const enum PairingStates {
  M1 = 0x01,
  M2 = 0x02,
  M3 = 0x03,
  M4 = 0x04,
  M5 = 0x05,
  M6 = 0x06
}

/**
 * TLV error codes for the {@link TLVValues.ERROR_CODE} field.
 */
export const enum TLVErrorCode {
  // noinspection JSUnusedGlobalSymbols
  UNKNOWN = 0x01,
  INVALID_REQUEST = 0x02,
  AUTHENTICATION = 0x02, // setup code or signature verification failed
  BACKOFF = 0x03, // // client must look at retry delay tlv item
  MAX_PEERS = 0x04, // server cannot accept any more pairings
  MAX_TRIES = 0x05, // server reached maximum number of authentication attempts
  UNAVAILABLE = 0x06, // server pairing method is unavailable
  BUSY = 0x07 // cannot accept pairing request at this time
}

export const enum HAPStatus {
  // noinspection JSUnusedGlobalSymbols
  SUCCESS = 0,
  INSUFFICIENT_PRIVILEGES = -70401,
  SERVICE_COMMUNICATION_FAILURE = -70402,
  RESOURCE_BUSY = -70403,
  READ_ONLY_CHARACTERISTIC = -70404, // cannot write to read only
  WRITE_ONLY_CHARACTERISTIC = -70405, // cannot read from write only
  NOTIFICATION_NOT_SUPPORTED = -70406,
  OUT_OF_RESOURCE = -70407,
  OPERATION_TIMED_OUT = -70408,
  RESOURCE_DOES_NOT_EXIST = -70409,
  INVALID_VALUE_IN_REQUEST = -70410,
  INSUFFICIENT_AUTHORIZATION = -70411,
  NOT_ALLOWED_IN_CURRENT_STATE = -70412,

  // when adding new status codes, remember to update bounds in IsKnownHAPStatusError below
}

/**
 * Determines if the given status code is a known {@link HAPStatus} error code.
 */
export function IsKnownHAPStatusError(status: HAPStatus): boolean {
  return (
    // Lower bound (most negative error code)
    status >= HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE &&
    // Upper bound (negative error code closest to zero)
    status <= HAPStatus.INSUFFICIENT_PRIVILEGES
  );
}

// noinspection JSUnusedGlobalSymbols
/**
 * @deprecated please use {@link TLVErrorCode} as naming is more precise
 */
// @ts-expect-error (as we use const enums with --preserveConstEnums)
export const Codes = TLVErrorCode;
// noinspection JSUnusedGlobalSymbols
/**
 * @deprecated please use {@link HAPStatus} as naming is more precise
 */
// @ts-expect-error (as we use const enums with --preserveConstEnums)
export const Status = HAPStatus;

/**
 * Those status codes are the one listed as appropriate for the HAP spec!
 *
 * When the response is a client error 4xx or server error 5xx, the response
 * must include a status {@link HAPStatus} property.
 *
 * When the response is a MULTI_STATUS EVERY entry in the characteristics property MUST include a status property (even success).
 */
export const enum HAPHTTPCode {
  // noinspection JSUnusedGlobalSymbols
  OK = 200,
  NO_CONTENT = 204,
  MULTI_STATUS = 207,

  // client error
  BAD_REQUEST = 400, // e.g. malformed request
  NOT_FOUND = 404,
  UNPROCESSABLE_ENTITY = 422, // for well-formed requests tha contain invalid http parameters (semantics are wrong and not syntax)

  // server error
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503, // e.g. max connections reached
}

/**
 * When in a request is made to the pairing endpoints, and mime type is 'application/pairing+tlv8'
 * one should use the below status codes.
 */
export const enum HAPPairingHTTPCode {
  // noinspection JSUnusedGlobalSymbols
  OK = 200,

  BAD_REQUEST = 400, // e.g. bad tlv, state errors, etc
  METHOD_NOT_ALLOWED = 405,
  TOO_MANY_REQUESTS = 429, // e.g. attempt to pair while already pairing
  CONNECTION_AUTHORIZATION_REQUIRED = 470, // didn't do pair-verify step

  INTERNAL_SERVER_ERROR = 500,
}

type HAPRequestHandler = (connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse) => void;

export type IdentifyCallback = VoidCallback;

export type HAPHttpError = { httpCode: HAPHTTPCode, status: HAPStatus};

export type PairingsCallback<T = void> = (error: TLVErrorCode | 0, data?: T) => void;
export type AddPairingCallback = PairingsCallback;
export type RemovePairingCallback = PairingsCallback;
export type ListPairingsCallback = PairingsCallback<PairingInformation[]>;
export type PairCallback = VoidCallback;
export type AccessoriesCallback = (error: HAPHttpError | undefined, result?: AccessoriesResponse) => void;
export type ReadCharacteristicsCallback = (error: HAPHttpError | undefined, response?: CharacteristicsReadResponse) => void;
export type WriteCharacteristicsCallback = (error: HAPHttpError | undefined, response?: CharacteristicsWriteResponse) => void;
export type ResourceRequestCallback = (error: HAPHttpError | undefined, resource?: Buffer) => void;

export const enum HAPServerEventTypes {
  /**
   * Emitted when the server is fully set up and ready to receive connections.
   */
  LISTENING = "listening",
  /**
   * Emitted when a client wishes for this server to identify itself before pairing. You must call the
   * callback to respond to the client with success.
   */
  IDENTIFY = "identify",
  ADD_PAIRING = "add-pairing",
  REMOVE_PAIRING = "remove-pairing",
  LIST_PAIRINGS = "list-pairings",
  /**
   * This event is emitted when a client completes the "pairing" process and exchanges encryption keys.
   * Note that this does not mean the "Add Accessory" process in iOS has completed.
   * You must call the callback to complete the process.
   */
  PAIR = "pair",
  /**
   * This event is emitted when a client requests the complete representation of Accessory data for
   * this Accessory (for instance, what services, characteristics, etc. are supported) and any bridged
   * Accessories in the case of a Bridge Accessory. The listener must call the provided callback function
   * when the accessory data is ready. We will automatically JSON.stringify the data.
   */
  ACCESSORIES = "accessories",
  /**
   * This event is emitted when a client wishes to retrieve the current value of one or more characteristics.
   * The listener must call the provided callback function when the values are ready. iOS clients can typically
   * wait up to 10 seconds for this call to return. We will automatically JSON.stringify the data (which must
   * be an array) and wrap it in an object with a top-level "characteristics" property.
   */
  GET_CHARACTERISTICS = "get-characteristics",
  /**
   * This event is emitted when a client wishes to set the current value of one or more characteristics and/or
   * subscribe to one or more events. The 'events' param is an initially-empty object, associated with the current
   * connection, on which you may store event registration keys for later processing. The listener must call
   * the provided callback when the request has been processed.
   */
  SET_CHARACTERISTICS = "set-characteristics",
  REQUEST_RESOURCE = "request-resource",
  CONNECTION_CLOSED = "connection-closed",
}

export declare interface HAPServer {
  on(event: "listening", listener: (port: number, address: string) => void): this;
  on(event: "identify", listener: (callback: IdentifyCallback) => void): this;

  on(event: "add-pairing", listener: (connection: HAPConnection, username: HAPUsername, publicKey: Buffer, permission: PermissionTypes, callback: AddPairingCallback) => void): this;
  on(event: "remove-pairing", listener: (connection: HAPConnection, username: HAPUsername, callback: RemovePairingCallback) => void): this;
  on(event: "list-pairings", listener: (connection: HAPConnection, callback: ListPairingsCallback) => void): this;
  on(event: "pair", listener: (username: HAPUsername, clientLTPK: Buffer, callback: PairCallback) => void): this;

  on(event: "accessories", listener: (connection: HAPConnection, callback: AccessoriesCallback) => void): this;
  on(event: "get-characteristics", listener: (connection: HAPConnection, request: CharacteristicsReadRequest, callback: ReadCharacteristicsCallback) => void): this;
  on(event: "set-characteristics", listener: (connection: HAPConnection, request: CharacteristicsWriteRequest, callback: WriteCharacteristicsCallback) => void): this;
  on(event: "request-resource", listener: (resource: ResourceRequest, callback: ResourceRequestCallback) => void): this;

  on(event: "connection-closed", listener: (connection: HAPConnection) => void): this;


  emit(event: "listening", port: number, address: string): boolean;
  emit(event: "identify", callback : IdentifyCallback): boolean;

  emit(event: "add-pairing", connection: HAPConnection, username: HAPUsername, publicKey: Buffer, permission: PermissionTypes, callback: AddPairingCallback): boolean;
  emit(event: "remove-pairing", connection: HAPConnection, username: HAPUsername, callback: RemovePairingCallback): boolean;
  emit(event: "list-pairings", connection: HAPConnection, callback: ListPairingsCallback): boolean;
  emit(event: "pair", username: HAPUsername, clientLTPK: Buffer, callback: PairCallback): boolean;

  emit(event: "accessories", connection: HAPConnection, callback : AccessoriesCallback): boolean;
  emit(event: "get-characteristics", connection: HAPConnection, request: CharacteristicsReadRequest, callback: ReadCharacteristicsCallback): boolean;
  emit(event: "set-characteristics", connection: HAPConnection, request: CharacteristicsWriteRequest, callback: WriteCharacteristicsCallback): boolean;
  emit(event: "request-resource", resource: ResourceRequest, callback: ResourceRequestCallback): boolean;

  emit(event: "connection-closed", connection: HAPConnection): boolean;
}

/**
 * The actual HAP server that iOS devices talk to.
 *
 * Notes
 * -----
 * It turns out that the IP-based version of HomeKit's HAP protocol operates over a sort of pseudo-HTTP.
 * Accessories are meant to host a TCP socket server that initially behaves exactly as an HTTP/1.1 server.
 * So iOS devices will open up a long-lived connection to this server and begin issuing HTTP requests.
 * So far, this conforms with HTTP/1.1 Keepalive. However, after the "pairing" process is complete, the
 * connection is expected to be "upgraded" to support full-packet encryption of both HTTP headers and data.
 * This encryption is NOT SSL. It is a customized ChaCha20+Poly1305 encryption layer.
 *
 * Additionally, this "HTTP Server" supports sending "event" responses at any time without warning. The iOS
 * device simply keeps the connection open after it's finished with HTTP request/response traffic, and while
 * the connection is open, the server can elect to issue "EVENT/1.0 200 OK" HTTP-style responses. These are
 * typically sent to inform the iOS device of a characteristic change for the accessory (like "Door was Unlocked").
 *
 * See eventedhttp.js for more detail on the implementation of this protocol.
 */
export class HAPServer extends EventEmitter {

  private accessoryInfo: AccessoryInfo;
  private httpServer: EventedHTTPServer;
  private unsuccessfulPairAttempts: number = 0; // after 100 unsuccessful attempts the server won't accept any further attempts. Will currently be reset on a reboot

  allowInsecureRequest: boolean;

  constructor(accessoryInfo: AccessoryInfo) {
    super();
    this.accessoryInfo = accessoryInfo;
    this.allowInsecureRequest = false;
    // internal server that does all the actual communication
    this.httpServer = new EventedHTTPServer();
    this.httpServer.on(EventedHTTPServerEvent.LISTENING, this.onListening.bind(this));
    this.httpServer.on(EventedHTTPServerEvent.REQUEST, this.handleRequestOnHAPConnection.bind(this));
    this.httpServer.on(EventedHTTPServerEvent.CONNECTION_CLOSED, this.handleConnectionClosed.bind(this));
  }

  public listen(port: number = 0, host?: string): void {
    if (host === "::") {
      // this will workaround "EAFNOSUPPORT: address family not supported" errors
      // on systems where IPv6 is not supported/enabled, we just use the node default then by supplying undefined
      host = undefined
    }

    this.httpServer.listen(port, host);
  }

  public stop(): void {
    this.httpServer.stop();
  }

  public destroy(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Send a even notification for given characteristic and changed value to all connected clients.
   * If {@param originator} is specified, the given {@link HAPConnection} will be excluded from the broadcast.
   *
   * @param aid - The accessory id of the updated characteristic.
   * @param iid - The instance id of the updated characteristic.
   * @param value - The newly set value of the characteristic.
   * @param originator - If specified, the connection will not get a event message.
   * @param immediateDelivery - The HAP spec requires some characteristics to be delivery immediately.
   *   Namely for the {@link ButtonEvent} and the {@link ProgrammableSwitchEvent} characteristics.
   */
  public sendEventNotifications(aid: number, iid: number, value: Nullable<CharacteristicValue>, originator?: HAPConnection, immediateDelivery?: boolean): void {
    try {
      this.httpServer.broadcastEvent(aid, iid, value, originator, immediateDelivery);
    } catch (error) {
      console.warn("[" + this.accessoryInfo.username + "] Error when sending event notifications: " + error.message);
    }
  }

  private onListening(port: number, hostname: string): void {
    this.emit(HAPServerEventTypes.LISTENING, port, hostname);
  }

  // Called when an HTTP request was detected.
  private handleRequestOnHAPConnection(connection: HAPConnection, request: IncomingMessage, response: ServerResponse): void {
    debug("[%s] HAP Request: %s %s", this.accessoryInfo.username, request.method, request.url);
    const buffers: Buffer[] = [];
    request.on('data', data => buffers.push(data));

    request.on('end', () => {
      const url = new URL(request.url!, "http://hap-nodejs.local"); // parse the url (query strings etc)

      const handler = this.getHandler(url); // TODO check that content-type is supported by the handler?

      if (!handler) {
        debug("[%s] WARNING: Handler for %s not implemented", this.accessoryInfo.username, request.url);
        response.writeHead(HAPHTTPCode.NOT_FOUND, {'Content-Type': 'application/hap+json'});
        response.end(JSON.stringify({ status: HAPStatus.RESOURCE_DOES_NOT_EXIST }));
      } else {
        const data = Buffer.concat(buffers);
        try {
          handler(connection, url, request, data, response);
        } catch (error) {
          debug("[%s] Error executing route handler: %s", this.accessoryInfo.username, error.stack);
          response.writeHead(HAPHTTPCode.INTERNAL_SERVER_ERROR, {'Content-Type': 'application/hap+json'});
          response.end(JSON.stringify({ status: HAPStatus.RESOURCE_BUSY })); // resource busy try again, does somehow fit?
        }
      }
    });
  }

  private handleConnectionClosed(connection: HAPConnection): void {
    this.emit(HAPServerEventTypes.CONNECTION_CLOSED, connection);
  }

  private getHandler(url: URL): HAPRequestHandler | undefined {
    switch (url.pathname.toLowerCase()) {
      case "/identify":
        return this.handleIdentifyRequest.bind(this);
      case "/pair-setup":
        return this.handlePairSetup.bind(this);
      case "/pair-verify":
        return this.handlePairVerify.bind(this);
      case "/pairings":
        return this.handlePairings.bind(this);
      case "/accessories":
        return this.handleAccessories.bind(this);
      case "/characteristics":
        return this.handleCharacteristics.bind(this);
      case "/prepare":
        return this.handlePrepareWrite.bind(this);
      case "/resource":
        return this.handleResource.bind(this);
      default:
        return undefined;
    }
  }

  /**
   * UNPAIRED Accessory identification.
   */
  private handleIdentifyRequest(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    // POST body is empty
    if (!this.allowInsecureRequest && this.accessoryInfo.paired()) {
      response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({ status: HAPStatus.INSUFFICIENT_PRIVILEGES }));
      return;
    }

    this.emit(HAPServerEventTypes.IDENTIFY, once((err: Error) => {
      if (!err) {
        debug("[%s] Identification success", this.accessoryInfo.username);
        response.writeHead(HAPHTTPCode.NO_CONTENT);
        response.end();
      } else {
        debug("[%s] Identification error: %s", this.accessoryInfo.username, err.message);
        response.writeHead(HAPHTTPCode.INTERNAL_SERVER_ERROR, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: HAPStatus.RESOURCE_BUSY }));
      }
    }));
  }

  private handlePairSetup(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    // Can only be directly paired with one iOS device
    if (!this.allowInsecureRequest && this.accessoryInfo.paired()) {
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, TLVErrorCode.UNAVAILABLE));
      return;
    }
    if (this.unsuccessfulPairAttempts > 100) {
      debug("[%s] Reached maximum amount of unsuccessful pair attempts!", this.accessoryInfo.username);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, TLVErrorCode.MAX_TRIES));
      return;
    }

    const tlvData = tlv.decode(data);
    const sequence = tlvData[TLVValues.SEQUENCE_NUM][0]; // value is single byte with sequence number
    if (sequence == PairingStates.M1) {
      this.handlePairSetupM1(connection, request, response);
    } else if (sequence == PairingStates.M3 && connection._pairSetupState === PairingStates.M2) {
      this.handlePairSetupM3(connection, request, response, tlvData);
    } else if (sequence == PairingStates.M5 && connection._pairSetupState === PairingStates.M4) {
      this.handlePairSetupM5(connection, request, response, tlvData);
    } else {
      // Invalid state/sequence number
      response.writeHead(HAPPairingHTTPCode.BAD_REQUEST, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, sequence + 1, TLVValues.ERROR_CODE, TLVErrorCode.UNKNOWN));
      return;
    }
  }

  private handlePairSetupM1(connection: HAPConnection, request: IncomingMessage, response: ServerResponse): void {
    debug("[%s] Pair step 1/5", this.accessoryInfo.username);
    const salt = crypto.randomBytes(16, );

    const srpParams = SRP.params.hap;
    SRP.genKey(32).then(key => {
      // create a new SRP server
      const srpServer = new SrpServer(srpParams, salt, Buffer.from("Pair-Setup"), Buffer.from(this.accessoryInfo.pincode), key)
      const srpB = srpServer.computeB();
      // attach it to the current TCP session
      connection.srpServer = srpServer;
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M2, TLVValues.SALT, salt, TLVValues.PUBLIC_KEY, srpB));
      connection._pairSetupState = PairingStates.M2;
    }).catch(error => {
      debug("[%s] Error occurred when generating srp key: %s", this.accessoryInfo.username, error.message);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, TLVErrorCode.UNKNOWN));
      return;
    });
  }

  private handlePairSetupM3(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, tlvData: Record<number, Buffer>): void {
    debug("[%s] Pair step 2/5", this.accessoryInfo.username);
    const A = tlvData[TLVValues.PUBLIC_KEY]; // "A is a public key that exists only for a single login session."
    const M1 = tlvData[TLVValues.PASSWORD_PROOF]; // "M1 is the proof that you actually know your own password."
    // pull the SRP server we created in stepOne out of the current session
    const srpServer = connection.srpServer!;
    srpServer.setA(A);
    try {
      srpServer.checkM1(M1);
    } catch (err) {
      // most likely the client supplied an incorrect pincode.
      this.unsuccessfulPairAttempts++;
      debug("[%s] Error while checking pincode: %s", this.accessoryInfo.username, err.message);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M4, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairSetupState = undefined;
      return;
    }
    // "M2 is the proof that the server actually knows your password."
    const M2 = srpServer.computeM2();
    response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
    response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M4, TLVValues.PASSWORD_PROOF, M2));
    connection._pairSetupState = PairingStates.M4;
  }

  private handlePairSetupM5(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, tlvData: Record<number, Buffer>): void {
    debug("[%s] Pair step 3/5", this.accessoryInfo.username);
    // pull the SRP server we created in stepOne out of the current session
    const srpServer = connection.srpServer!;
    const encryptedData = tlvData[TLVValues.ENCRYPTED_DATA];
    const messageData = Buffer.alloc(encryptedData.length - 16);
    const authTagData = Buffer.alloc(16);
    encryptedData.copy(messageData, 0, 0, encryptedData.length - 16);
    encryptedData.copy(authTagData, 0, encryptedData.length - 16, encryptedData.length);
    const S_private = srpServer.computeK();
    const encSalt = Buffer.from("Pair-Setup-Encrypt-Salt");
    const encInfo = Buffer.from("Pair-Setup-Encrypt-Info");
    const outputKey = hapCrypto.HKDF("sha512", encSalt, S_private, encInfo, 32);

    let plaintext;
    try {
      plaintext = hapCrypto.chacha20_poly1305_decryptAndVerify(outputKey, Buffer.from("PS-Msg05"), null, messageData, authTagData);
    } catch (error) {
      debug("[%s] Error while decrypting and verifying M5 subTlv: %s", this.accessoryInfo.username);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M4, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairSetupState = undefined;
      return;
    }
    // decode the client payload and pass it on to the next step
    const M5Packet = tlv.decode(plaintext);
    const clientUsername = M5Packet[TLVValues.USERNAME];
    const clientLTPK = M5Packet[TLVValues.PUBLIC_KEY];
    const clientProof = M5Packet[TLVValues.PROOF];
    this.handlePairSetupM5_2(connection, request, response, clientUsername, clientLTPK, clientProof, outputKey);
  }

  // M5-2
  private handlePairSetupM5_2(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, clientUsername: Buffer, clientLTPK: Buffer, clientProof: Buffer, hkdfEncKey: Buffer): void {
    debug("[%s] Pair step 4/5", this.accessoryInfo.username);
    const S_private = connection.srpServer!.computeK();
    const controllerSalt = Buffer.from("Pair-Setup-Controller-Sign-Salt");
    const controllerInfo = Buffer.from("Pair-Setup-Controller-Sign-Info");
    const outputKey = hapCrypto.HKDF("sha512", controllerSalt, S_private, controllerInfo, 32);
    const completeData = Buffer.concat([outputKey, clientUsername, clientLTPK]);
    if (!tweetnacl.sign.detached.verify(completeData, clientProof, clientLTPK)) {
      debug("[%s] Invalid signature", this.accessoryInfo.username);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M6, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairSetupState = undefined;
      return;
    }
    this.handlePairSetupM5_3(connection, request, response, clientUsername, clientLTPK, hkdfEncKey);
  }

  // M5 - F + M6
  private handlePairSetupM5_3(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, clientUsername: Buffer, clientLTPK: Buffer, hkdfEncKey: Buffer): void {
    debug("[%s] Pair step 5/5", this.accessoryInfo.username);
    const S_private = connection.srpServer!.computeK();
    const accessorySalt = Buffer.from("Pair-Setup-Accessory-Sign-Salt");
    const accessoryInfo = Buffer.from("Pair-Setup-Accessory-Sign-Info");
    const outputKey = hapCrypto.HKDF("sha512", accessorySalt, S_private, accessoryInfo, 32);
    const serverLTPK = this.accessoryInfo.signPk;
    const usernameData = Buffer.from(this.accessoryInfo.username);
    const material = Buffer.concat([outputKey, usernameData, serverLTPK]);
    const privateKey = Buffer.from(this.accessoryInfo.signSk);
    const serverProof = tweetnacl.sign.detached(material, privateKey);
    const message = tlv.encode(TLVValues.USERNAME, usernameData, TLVValues.PUBLIC_KEY, serverLTPK, TLVValues.PROOF, serverProof);

    const encrypted = hapCrypto.chacha20_poly1305_encryptAndSeal(hkdfEncKey, Buffer.from("PS-Msg06"), null, message);

    // finally, notify listeners that we have been paired with a client
    this.emit(HAPServerEventTypes.PAIR, clientUsername.toString(), clientLTPK, once((err?: Error) => {
      if (err) {
        debug("[%s] Error adding pairing info: %s", this.accessoryInfo.username, err.message);
        response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
        response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M6, TLVValues.ERROR_CODE, TLVErrorCode.UNKNOWN));
        connection._pairSetupState = undefined;
        return;
      }
      // send final pairing response to client
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M6, TLVValues.ENCRYPTED_DATA, Buffer.concat([encrypted.ciphertext, encrypted.authTag])));
      connection._pairSetupState = undefined;
    }));
  }

  private handlePairVerify(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    const tlvData = tlv.decode(data);
    const sequence = tlvData[TLVValues.SEQUENCE_NUM][0]; // value is single byte with sequence number

    if (sequence == PairingStates.M1)
      this.handlePairVerifyM1(connection, request, response, tlvData);
    else if (sequence == PairingStates.M3 && connection._pairVerifyState === PairingStates.M2)
      this.handlePairVerifyM2(connection, request, response, tlvData);
    else {
      // Invalid state/sequence number
      response.writeHead(HAPPairingHTTPCode.BAD_REQUEST, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, sequence + 1, TLVValues.ERROR_CODE, TLVErrorCode.UNKNOWN));
      return;
    }
  }

  private handlePairVerifyM1(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, tlvData: Record<number, Buffer>): void {
    debug("[%s] Pair verify step 1/2", this.accessoryInfo.username);
    const clientPublicKey = tlvData[TLVValues.PUBLIC_KEY]; // Buffer
    // generate new encryption keys for this session
    const keyPair = hapCrypto.generateCurve25519KeyPair();
    const secretKey = Buffer.from(keyPair.secretKey);
    const publicKey = Buffer.from(keyPair.publicKey);
    const sharedSec = Buffer.from(hapCrypto.generateCurve25519SharedSecKey(secretKey, clientPublicKey));
    const usernameData = Buffer.from(this.accessoryInfo.username);
    const material = Buffer.concat([publicKey, usernameData, clientPublicKey]);
    const privateKey = Buffer.from(this.accessoryInfo.signSk);
    const serverProof = tweetnacl.sign.detached(material, privateKey);
    const encSalt = Buffer.from("Pair-Verify-Encrypt-Salt");
    const encInfo = Buffer.from("Pair-Verify-Encrypt-Info");
    const outputKey = hapCrypto.HKDF("sha512", encSalt, sharedSec, encInfo, 32).slice(0, 32);

    connection.encryption = new HAPEncryption(clientPublicKey, secretKey, publicKey, sharedSec, outputKey);

    // compose the response data in TLV format
    const message = tlv.encode(TLVValues.USERNAME, usernameData, TLVValues.PROOF, serverProof);

    const encrypted = hapCrypto.chacha20_poly1305_encryptAndSeal(outputKey, Buffer.from("PV-Msg02"), null, message);

    response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
    response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M2, TLVValues.ENCRYPTED_DATA, Buffer.concat([encrypted.ciphertext, encrypted.authTag]), TLVValues.PUBLIC_KEY, publicKey));
    connection._pairVerifyState = PairingStates.M2;
  }

  private handlePairVerifyM2(connection: HAPConnection, request: IncomingMessage, response: ServerResponse, objects: Record<number, Buffer>): void {
    debug("[%s] Pair verify step 2/2", this.accessoryInfo.username);
    const encryptedData = objects[TLVValues.ENCRYPTED_DATA];
    const messageData = Buffer.alloc(encryptedData.length - 16);
    const authTagData = Buffer.alloc(16);
    encryptedData.copy(messageData, 0, 0, encryptedData.length - 16);
    encryptedData.copy(authTagData, 0, encryptedData.length - 16, encryptedData.length);

    // instance of HAPEncryption (created in handlePairVerifyStepOne)
    const enc = connection.encryption!;

    let plaintext;
    try {
      plaintext = hapCrypto.chacha20_poly1305_decryptAndVerify(enc.hkdfPairEncryptionKey, Buffer.from("PV-Msg03"), null, messageData, authTagData);
    } catch (error) {
      debug("[%s] M3: Failed to decrypt and/or verify", this.accessoryInfo.username);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M4, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairVerifyState = undefined;
      return;
    }

    const decoded = tlv.decode(plaintext);
    const clientUsername = decoded[TLVValues.USERNAME];
    const proof = decoded[TLVValues.PROOF];
    const material = Buffer.concat([enc.clientPublicKey, clientUsername, enc.publicKey]);
    // since we're paired, we should have the public key stored for this client
    const clientPublicKey = this.accessoryInfo.getClientPublicKey(clientUsername.toString());
    // if we're not actually paired, then there's nothing to verify - this client thinks it's paired with us but we
    // disagree. Respond with invalid request (seems to match HomeKit Accessory Simulator behavior)
    if (!clientPublicKey) {
      debug("[%s] Client %s attempting to verify, but we are not paired; rejecting client", this.accessoryInfo.username, clientUsername);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M4, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairVerifyState = undefined;
      return;
    }
    if (!tweetnacl.sign.detached.verify(material, proof, clientPublicKey)) {
      debug("[%s] Client %s provided an invalid signature", this.accessoryInfo.username, clientUsername);
      response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
      response.end(tlv.encode(TLVValues.STATE, PairingStates.M4, TLVValues.ERROR_CODE, TLVErrorCode.AUTHENTICATION));
      connection._pairVerifyState = undefined;
      return;
    }
    debug("[%s] Client %s verification complete", this.accessoryInfo.username, clientUsername);
    response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
    response.end(tlv.encode(TLVValues.SEQUENCE_NUM, PairingStates.M4));
    // now that the client has been verified, we must "upgrade" our pseudo-HTTP connection to include
    // TCP-level encryption. We'll do this by adding some more encryption vars to the session, and using them
    // in future calls to onEncrypt, onDecrypt.
    const encSalt = Buffer.from("Control-Salt");
    const infoRead = Buffer.from("Control-Read-Encryption-Key");
    const infoWrite = Buffer.from("Control-Write-Encryption-Key");
    enc.accessoryToControllerKey = hapCrypto.HKDF("sha512", encSalt, enc.sharedSecret, infoRead, 32);
    enc.controllerToAccessoryKey = hapCrypto.HKDF("sha512", encSalt, enc.sharedSecret, infoWrite, 32);
    // Our connection is now completely setup. We now want to subscribe this connection to special

    connection.connectionAuthenticated(clientUsername.toString());
    connection._pairVerifyState = undefined;
  }

  private handlePairings(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    // Only accept /pairing request if there is a secure session
    if (!this.allowInsecureRequest && !connection.isAuthenticated()) {
      response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({ status: HAPStatus.INSUFFICIENT_PRIVILEGES }));
      return;
    }

    const objects = tlv.decode(data);
    const method = objects[TLVValues.METHOD][0]; // value is single byte with request type

    const state = objects[TLVValues.STATE][0];
    if (state !== PairingStates.M1) {
      return;
    }

    if (method === PairMethods.ADD_PAIRING) {
      const identifier = objects[TLVValues.IDENTIFIER].toString();
      const publicKey = objects[TLVValues.PUBLIC_KEY];
      const permissions = objects[TLVValues.PERMISSIONS][0] as PermissionTypes;

      this.emit(HAPServerEventTypes.ADD_PAIRING, connection, identifier, publicKey, permissions, once((error: TLVErrorCode | 0) => {
        if (error > 0) {
          debug("[%s] Pairings: failed ADD_PAIRING with code %d", this.accessoryInfo.username, error);
          response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
          response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, error));
          return;
        }

        response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
        response.end(tlv.encode(TLVValues.STATE, PairingStates.M2));
        debug("[%s] Pairings: successfully executed ADD_PAIRING", this.accessoryInfo.username);
      }));
    } else if (method === PairMethods.REMOVE_PAIRING) {
      const identifier = objects[TLVValues.IDENTIFIER].toString();

      this.emit(HAPServerEventTypes.REMOVE_PAIRING, connection, identifier, once((error: TLVErrorCode | 0) => {
        if (error > 0) {
          debug("[%s] Pairings: failed REMOVE_PAIRING with code %d", this.accessoryInfo.username, error);
          response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
          response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, error));
          return;
        }

        response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
        response.end(tlv.encode(TLVValues.STATE, PairingStates.M2));
        debug("[%s] Pairings: successfully executed REMOVE_PAIRING", this.accessoryInfo.username);
      }));
    } else if (method === PairMethods.LIST_PAIRINGS) {
      this.emit(HAPServerEventTypes.LIST_PAIRINGS, connection, once((error: TLVErrorCode | 0, data?: PairingInformation[]) => {
        if (error > 0) {
          debug("[%s] Pairings: failed LIST_PAIRINGS with code %d", this.accessoryInfo.username, error);
          response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
          response.end(tlv.encode(TLVValues.STATE, PairingStates.M2, TLVValues.ERROR_CODE, error));
          return;
        }

        const tlvList = [] as any[];
        data!.forEach((value: PairingInformation, index: number) => {
          if (index > 0) {
            tlvList.push(TLVValues.SEPARATOR, Buffer.alloc(0));
          }

          tlvList.push(
              TLVValues.IDENTIFIER, value.username,
              TLVValues.PUBLIC_KEY, value.publicKey,
              TLVValues.PERMISSIONS, value.permission
          );
        });

        const list = tlv.encode(TLVValues.STATE, PairingStates.M2, ...tlvList);
        response.writeHead(HAPPairingHTTPCode.OK, {"Content-Type": "application/pairing+tlv8"});
        response.end(list);
        debug("[%s] Pairings: successfully executed LIST_PAIRINGS", this.accessoryInfo.username);
      }));
    }
  }

  private handleAccessories(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    if (!this.allowInsecureRequest && !connection.isAuthenticated()) {
      response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({status: HAPStatus.INSUFFICIENT_PRIVILEGES}));
      return;
    }
    // call out to listeners to retrieve the latest accessories JSON
    this.emit(HAPServerEventTypes.ACCESSORIES, connection, once((error: HAPHttpError | undefined, result: AccessoriesResponse) => {
      if (error) {
        response.writeHead(error.httpCode, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: error.status }));
      } else {
        response.writeHead(HAPHTTPCode.OK, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify(result));
      }
    }));
  }

  private handleCharacteristics(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    if (!this.allowInsecureRequest && !connection.isAuthenticated()) {
      response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({status: HAPStatus.INSUFFICIENT_PRIVILEGES}));
      return;
    }

    if (request.method === "GET") {
      const searchParams = url.searchParams;

      const idParam = searchParams.get("id");
      if (!idParam) {
        response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
        return;
      }

      const ids: CharacteristicId[] = [];
      for (const entry of idParam.split(",")) { // ["1.9","2.14"]
        const split = entry.split(".") // ["1","9"]
        ids.push({
          aid: parseInt(split[0], 10), // accessory Id
          iid: parseInt(split[1], 10), // (characteristic) instance Id
        });
      }

      const readRequest: CharacteristicsReadRequest = {
        ids: ids,
        includeMeta: consideredTrue(searchParams.get("meta")),
        includePerms: consideredTrue(searchParams.get("perms")),
        includeType: consideredTrue(searchParams.get("type")),
        includeEvent: consideredTrue(searchParams.get("ev")),
      };

      this.emit(HAPServerEventTypes.GET_CHARACTERISTICS, connection, readRequest, once((error: HAPHttpError | undefined, readResponse: CharacteristicsReadResponse) => {
        if (error) {
          response.writeHead(error.httpCode, {"Content-Type": "application/hap+json"});
          response.end(JSON.stringify({ status: error.status }));
          return;
        }

        const characteristics = readResponse.characteristics;

        let errorOccurred = false; // determine if we send a 207 Multi-Status
        for (const data of characteristics) {
          if (data.status) {
            errorOccurred = true;
            break;
          }
        }

        if (errorOccurred) { // on a 207 Multi-Status EVERY characteristic MUST include a status property
          for (const data of characteristics) {
            if (!data.status) { // a status is undefined if the request was successful
              data.status = HAPStatus.SUCCESS; // a value of zero indicates success
            }
          }
        }

        // 207 "multi-status" is returned when an error occurs reading a characteristic. otherwise 200 is returned
        response.writeHead(errorOccurred? HAPHTTPCode.MULTI_STATUS: HAPHTTPCode.OK, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ characteristics: characteristics }));
      }));
    } else if (request.method === "PUT") {
      if (!connection.isAuthenticated()) {
        if (!request.headers || (request.headers && request.headers["authorization"] !== this.accessoryInfo.pincode)) {
          response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
          response.end(JSON.stringify({status: HAPStatus.INSUFFICIENT_PRIVILEGES}));
          return;
        }
      }
      if (data.length === 0) {
        response.writeHead(400, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({status: HAPStatus.INVALID_VALUE_IN_REQUEST}));
        return;
      }

      const writeRequest = JSON.parse(data.toString("utf8")) as CharacteristicsWriteRequest;

      this.emit(HAPServerEventTypes.SET_CHARACTERISTICS, connection, writeRequest, once((error: HAPHttpError | undefined, writeResponse: CharacteristicsWriteResponse) => {
        if (error) {
          response.writeHead(error.httpCode, {"Content-Type": "application/hap+json"});
          response.end(JSON.stringify({ status: error.status }));
          return;
        }

        const characteristics = writeResponse.characteristics;

        let multiStatus = false;
        for (const data of characteristics) {
          if (data.status || data.value !== undefined) {
            // also send multiStatus on write response requests
            multiStatus = true;
            break;
          }
        }

        if (multiStatus) {
          for (const data of characteristics) { // on a 207 Multi-Status EVERY characteristic MUST include a status property
            if (data.status === undefined) {
              data.status = HAPStatus.SUCCESS;
            }
          }

          // 207 is "multi-status" since HomeKit may be setting multiple things and any one can fail independently
          response.writeHead(HAPHTTPCode.MULTI_STATUS, {"Content-Type": "application/hap+json"});
          response.end(JSON.stringify({ characteristics: characteristics }));
        } else {
          // if everything went fine send 204 no content response
          response.writeHead(HAPHTTPCode.NO_CONTENT);
          response.end();
        }
      }));
    } else {
      response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"}); // method not allowed
      response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
    }
  }

  private handlePrepareWrite(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    if (!this.allowInsecureRequest && !connection.isAuthenticated()) {
      response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({status: HAPStatus.INSUFFICIENT_PRIVILEGES}));
      return;
    }

    if (request.method == "PUT") {
      if (data.length == 0) {
        response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({status: HAPStatus.INVALID_VALUE_IN_REQUEST}));
        return;
      }

      const prepareRequest = JSON.parse(data.toString()) as PrepareWriteRequest;

      if (prepareRequest.pid && prepareRequest.ttl) {
        debug("[%s] Received prepare write request with pid %d and ttl %d", this.accessoryInfo.username, prepareRequest.pid, prepareRequest.ttl);

        if (connection.timedWriteTimeout) // clear any currently existing timeouts
          clearTimeout(connection.timedWriteTimeout);

        connection.timedWritePid = prepareRequest.pid;
        connection.timedWriteTimeout = setTimeout(() => {
          debug("[%s] Timed write request timed out for pid %d", this.accessoryInfo.username, prepareRequest.pid);
          connection.timedWritePid = undefined;
          connection.timedWriteTimeout = undefined;
        }, prepareRequest.ttl);

        response.writeHead(HAPHTTPCode.OK, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({status: HAPStatus.SUCCESS}));
        return;
      } else {
        response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
      }
    } else {
      response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
      response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
    }
  }

  private handleResource(connection: HAPConnection, url: URL, request: IncomingMessage, data: Buffer, response: ServerResponse): void {
    if (!connection.isAuthenticated()) {
      if (!(this.allowInsecureRequest && request.headers && request.headers.authorization === this.accessoryInfo.pincode)) {
        response.writeHead(HAPPairingHTTPCode.CONNECTION_AUTHORIZATION_REQUIRED, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: HAPStatus.INSUFFICIENT_PRIVILEGES }));
        return;
      }
    }
    if (request.method === "POST") {
      if (data.length === 0) {
        response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"});
        response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
        return;
      }

      const resourceRequest = JSON.parse(data.toString()) as ResourceRequest;
      // call out to listeners to retrieve the resource, snapshot only right now
      this.emit(HAPServerEventTypes.REQUEST_RESOURCE, resourceRequest, once((error: HAPHttpError | undefined, resource: Buffer) => {
        if (error) {
          response.writeHead(error.httpCode, {"Content-Type": "application/hap+json"});
          response.end(JSON.stringify({ status: error.status }));
        } else {
          response.writeHead(HAPHTTPCode.OK, {"Content-Type": "image/jpeg"});
          response.end(resource);
        }
      }));
    } else {
      response.writeHead(HAPHTTPCode.BAD_REQUEST, {"Content-Type": "application/hap+json"}); // method not allowed
      response.end(JSON.stringify({ status: HAPStatus.INVALID_VALUE_IN_REQUEST }));
    }
  }

}
