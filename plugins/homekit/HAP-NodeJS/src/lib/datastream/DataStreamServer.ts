import assert from 'assert';
import crypto from 'crypto';
import createDebug from 'debug';
import { EventEmitter, EventEmitter as NodeEventEmitter } from "events";
import net, { Socket } from 'net';
import { HAPConnection, HAPConnectionEvent } from "../util/eventedhttp";

import * as hapCrypto from '../util/hapCrypto';
import { DataStreamParser, DataStreamReader, DataStreamWriter, Int64 } from './DataStreamParser';


const debug = createDebug('HAP-NodeJS:DataStream:Server');

export type PreparedDataStreamSession = {

    connection: HAPConnection, // reference to the hap session which created the request

    accessoryToControllerEncryptionKey: Buffer,
    controllerToAccessoryEncryptionKey: Buffer,
    accessoryKeySalt: Buffer,

    port?: number,

    connectTimeout?: NodeJS.Timeout, // 10s timer

}

export type PrepareSessionCallback = (error?: Error, preparedSession?: PreparedDataStreamSession) => void;
export type EventHandler = (message: Record<any, any>) => void;
export type RequestHandler = (id: number, message: Record<any, any>) => void;
export type ResponseHandler = (error: Error | undefined, status: HDSStatus | undefined, message: Record<any, any>) => void;
export type GlobalEventHandler = (connection: DataStreamConnection, message: Record<any, any>) => void;
export type GlobalRequestHandler = (connection: DataStreamConnection, id: number, message: Record<any, any>) => void;

export interface DataStreamProtocolHandler {

    eventHandler?: Record<string, EventHandler>,
    requestHandler?: Record<string, RequestHandler>,

}

export const enum Protocols { // a collection of currently known protocols
    CONTROL = "control",
    TARGET_CONTROL = "targetControl",
    DATA_SEND = "dataSend",
}

export const enum Topics { // a collection of currently known topics grouped by their protocol
    // control
    HELLO = "hello",

    // targetControl
    WHOAMI = "whoami",

    // dataSend
    OPEN = "open",
    DATA = "data",
    ACK = "ack",
    CLOSE = "close",
}

export enum HDSStatus {
    // noinspection JSUnusedGlobalSymbols
    SUCCESS = 0,
    OUT_OF_MEMORY = 1,
    TIMEOUT = 2,
    HEADER_ERROR = 3,
    PAYLOAD_ERROR = 4,
    MISSING_PROTOCOL = 5,
    PROTOCOL_SPECIFIC_ERROR = 6,
}

export enum DataSendCloseReason { // close reason used in the dataSend protocol
    // noinspection JSUnusedGlobalSymbols
    NORMAL = 0,
    NOT_ALLOWED = 1,
    BUSY = 2,
    CANCELLED = 3,
    UNSUPPORTED = 4,
    UNEXPECTED_FAILURE = 5,
    TIMEOUT = 6,
}


const enum ServerState {
    UNINITIALIZED, // server socket hasn't been created
    BINDING, // server is created and is currently trying to bind
    LISTENING, // server is created and currently listening for new connections
    CLOSING,
}

const enum ConnectionState {
    UNIDENTIFIED,
    EXPECTING_HELLO,
    READY,
    CLOSING,
    CLOSED,
}

type HDSFrame = {

    header: Buffer,
    cipheredPayload: Buffer,
    authTag: Buffer,
    plaintextPayload?: Buffer,

}

const enum MessageType {
    EVENT = 1,
    REQUEST = 2,
    RESPONSE = 3,
}

type DataStreamMessage = {
    type: MessageType,

    protocol: string,
    topic: string,
    id?: number, // for requests and responses
    status?: HDSStatus, // for responses

    message: Record<any, any>,
}

export const enum DataStreamServerEvent {
    /**
     * This event is emitted when a new client socket is received. At this point we have no idea to what
     * hap session this connection will be matched.
     */
    CONNECTION_OPENED = "connection-opened",
    /**
     * This event is emitted when the socket of a connection gets closed.
     */
    CONNECTION_CLOSED = "connection-closed",
}

export declare interface DataStreamServer {
    on(event: "connection-opened", listener: (connection: DataStreamConnection) => void): this;
    on(event: "connection-closed", listener: (connection: DataStreamConnection) => void): this;

    emit(event: "connection-opened", connection: DataStreamConnection): boolean;
    emit(event: "connection-closed", connection: DataStreamConnection): boolean;
}

/**
 * DataStreamServer which listens for incoming tcp connections and handles identification of new connections
 */
export class DataStreamServer extends EventEmitter {

    static readonly version = "1.0";

    private state: ServerState = ServerState.UNINITIALIZED;

    private static accessoryToControllerInfo = Buffer.from("HDS-Read-Encryption-Key");
    private static controllerToAccessoryInfo = Buffer.from("HDS-Write-Encryption-Key");

    private tcpServer?: net.Server;
    private tcpPort?: number;

    preparedSessions: PreparedDataStreamSession[] = [];
    private readonly connections: DataStreamConnection[] = [];
    private removeListenersOnceClosed = false;

    private readonly internalEventEmitter: NodeEventEmitter = new NodeEventEmitter(); // used for message event and message request handlers

    public constructor() {
        super();
    }

    /**
     * Registers a new event handler to handle incoming event messages.
     * The handler is only called for a connection if for the give protocol no ProtocolHandler
     * was registered on the connection level.
     *
     * @param protocol {string | Protocols} - name of the protocol to register the handler for
     * @param event {string | Topics} - name of the event (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalEventHandler} - function to be called for every occurring event
     */
    public onEventMessage(protocol: string | Protocols, event: string | Topics, handler: GlobalEventHandler): this {
        this.internalEventEmitter.on(protocol + "-e-" + event, handler);
        return this;
    }

    /**
     * Removes an registered event handler.
     *
     * @param protocol {string | Protocols} - name of the protocol to unregister the handler for
     * @param event {string | Topics} - name of the event (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalEventHandler} - registered event handler
     */
    public removeEventHandler(protocol: string | Protocols, event: string | Topics, handler: GlobalEventHandler): this {
        this.internalEventEmitter.removeListener(protocol + "-e-" + event, handler);
        return this;
    }

    /**
     * Registers a new request handler to handle incoming request messages.
     * The handler is only called for a connection if for the give protocol no ProtocolHandler
     * was registered on the connection level.
     *
     * @param protocol {string | Protocols} - name of the protocol to register the handler for
     * @param request {string | Topics} - name of the request (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalRequestHandler} - function to be called for every occurring request
     */
    public onRequestMessage(protocol: string | Protocols, request: string | Topics, handler: GlobalRequestHandler): this {
        this.internalEventEmitter.on(protocol + "-r-" + request, handler);
        return this;
    }

    /**
     * Removes an registered request handler.
     *
     * @param protocol {string | Protocols} - name of the protocol to unregister the handler for
     * @param request {string | Topics} - name of the request (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalRequestHandler} - registered request handler
     */
    public removeRequestHandler(protocol: string | Protocols, request: string | Topics, handler: GlobalRequestHandler): this {
        this.internalEventEmitter.removeListener(protocol + "-r-" + request, handler);
        return this;
    }

    public prepareSession(connection: HAPConnection, controllerKeySalt: Buffer, callback: PrepareSessionCallback) {
        debug("Preparing for incoming HDS connection from %s", connection.sessionID);
        const accessoryKeySalt = crypto.randomBytes(32);
        const salt = Buffer.concat([controllerKeySalt, accessoryKeySalt]);

        const accessoryToControllerEncryptionKey = hapCrypto.HKDF("sha512", salt, connection.encryption!.sharedSecret, DataStreamServer.accessoryToControllerInfo, 32);
        const controllerToAccessoryEncryptionKey = hapCrypto.HKDF("sha512", salt, connection.encryption!.sharedSecret, DataStreamServer.controllerToAccessoryInfo, 32);

        const preparedSession: PreparedDataStreamSession = {
            connection: connection,
            accessoryToControllerEncryptionKey: accessoryToControllerEncryptionKey,
            controllerToAccessoryEncryptionKey: controllerToAccessoryEncryptionKey,
            accessoryKeySalt: accessoryKeySalt,
            connectTimeout: setTimeout(() => this.timeoutPreparedSession(preparedSession), 10000),
        };
        preparedSession.connectTimeout!.unref();
        this.preparedSessions.push(preparedSession);

        this.checkTCPServerEstablished(preparedSession, (error) => {
            if (error) {
                callback(error);
            } else {
                callback(undefined, preparedSession);
            }
        });
    }

    private timeoutPreparedSession(preparedSession: PreparedDataStreamSession) {
        debug("Prepared HDS session timed out out since no connection was opened for 10 seconds (%s)", preparedSession.connection.sessionID);
        const index = this.preparedSessions.indexOf(preparedSession);
        if (index >= 0) {
            this.preparedSessions.splice(index, 1);
        }

        this.checkCloseable();
    }

    private checkTCPServerEstablished(preparedSession: PreparedDataStreamSession, callback: (error?: Error) => void) {
        switch (this.state) {
            case ServerState.UNINITIALIZED:
                debug("Starting up TCP server.");
                this.tcpServer = net.createServer();

                this.tcpServer.once('listening', this.listening.bind(this, preparedSession, callback));
                this.tcpServer.on('connection', this.onConnection.bind(this));
                this.tcpServer.on('close', this.closed.bind(this));

                this.tcpServer.listen();
                this.state = ServerState.BINDING;
                break;
            case ServerState.BINDING:
                debug("TCP server already running. Waiting for it to bind.");
                this.tcpServer!.once('listening', this.listening.bind(this, preparedSession, callback));
                break;
            case ServerState.LISTENING:
                debug("Instructing client to connect to already running TCP server");
                preparedSession.port = this.tcpPort;
                callback();
                break;
            case ServerState.CLOSING:
                debug("TCP socket is currently closing. Trying again when server is fully closed and opening a new one then.");
                this.tcpServer!.once('close', () => setTimeout(() => this.checkTCPServerEstablished(preparedSession, callback), 10));
                break;
        }
    }

    private listening(preparedSession: PreparedDataStreamSession, callback: (error?: Error) => void) {
        this.state = ServerState.LISTENING;

        const address = this.tcpServer!.address();
        if (address && typeof address !== "string") { // address is only typeof string when listening to a pipe or unix socket
            this.tcpPort = address.port;
            preparedSession.port = address.port;

            debug("TCP server is now listening for new data stream connections on port %s", address.port);
            callback();
        }
    }

    private onConnection(socket: Socket) {
        debug("[%s] New DataStream connection was established", socket.remoteAddress);
        const connection = new DataStreamConnection(socket);

        connection.on(DataStreamConnectionEvent.IDENTIFICATION, this.handleSessionIdentification.bind(this, connection));
        connection.on(DataStreamConnectionEvent.HANDLE_MESSAGE_GLOBALLY, this.handleMessageGlobally.bind(this, connection));
        connection.on(DataStreamConnectionEvent.CLOSED, this.connectionClosed.bind(this, connection));

        this.connections.push(connection);

        this.emit(DataStreamServerEvent.CONNECTION_OPENED, connection);
    }

    private handleSessionIdentification(connection: DataStreamConnection, firstFrame: HDSFrame, callback: IdentificationCallback) {
        let identifiedSession: PreparedDataStreamSession | undefined = undefined;
        for (let i = 0; i < this.preparedSessions.length; i++) {
            const preparedSession = this.preparedSessions[i];

            // if we successfully decrypt the first frame with this key we know to which session this connection belongs
            if (connection.decryptHDSFrame(firstFrame, preparedSession.controllerToAccessoryEncryptionKey)) {
                identifiedSession = preparedSession;
                break;
            }
        }

        callback(identifiedSession);

        if (identifiedSession) {
            debug("[%s] Connection was successfully identified (linked with sessionId: %s)", connection.remoteAddress, identifiedSession.connection.sessionID);
            const index = this.preparedSessions.indexOf(identifiedSession);
            if (index >= 0) {
                this.preparedSessions.splice(index, 1);
            }

            clearTimeout(identifiedSession.connectTimeout!);
            identifiedSession.connectTimeout = undefined;

            // we have currently no experience with data stream connections, maybe it would be good to index active connections
            // by their hap sessionId in order to clear out old but still open connections when the controller opens a new one
            // on the other hand the keepAlive should handle that also :thinking:
        } else { // we looped through all session and didn't find anything
            debug("[%s] Could not identify connection. Terminating.", connection.remoteAddress);
            connection.close(); // disconnecting since first message was not a valid hello
        }
    }

    private handleMessageGlobally(connection: DataStreamConnection, message: DataStreamMessage) {
        assert.notStrictEqual(message.type, MessageType.RESPONSE); // responses can't physically get here

        let separator = "";
        let args: any[] = [];
        if (message.type === MessageType.EVENT) {
            separator = "-e-";
        } else if (message.type === MessageType.REQUEST) {
            separator = "-r-";
            args.push(message.id!);
        }
        args.push(message.message);

        let hadListeners;
        try {
            hadListeners = this.internalEventEmitter.emit(message.protocol + separator + message.topic, connection, ...args);
        } catch (error) {
            hadListeners = true;
            debug("[%s] Error occurred while dispatching handler for HDS message: %o", connection.remoteAddress, message);
            debug(error.stack);
        }

        if (!hadListeners) {
            debug("[%s] WARNING no handler was found for message: %o", connection.remoteAddress, message);
        }
    }

    private connectionClosed(connection: DataStreamConnection) {
        debug("[%s] DataStream connection closed", connection.remoteAddress);

        this.connections.splice(this.connections.indexOf(connection), 1);
        this.emit(DataStreamServerEvent.CONNECTION_CLOSED, connection);

        this.checkCloseable();

        if (this.state === ServerState.CLOSING && this.removeListenersOnceClosed && this.connections.length === 0) {
            this.removeAllListeners(); // see this.destroy()
        }
    }

    private checkCloseable() {
        if (this.connections.length === 0 && this.preparedSessions.length === 0 && this.state < ServerState.CLOSING) {
            debug("Last connection disconnected. Closing the server now.");

            this.state = ServerState.CLOSING;
            this.tcpServer!.close();
        }
    }

    /**
     * This method will fully stop the DataStreamServer
     */
    public destroy(): void {
        if (this.state > ServerState.UNINITIALIZED && this.state < ServerState.CLOSING) {
            this.tcpServer!.close();
            for (const connection of this.connections) {
                connection.close();
            }
        }

        this.state = ServerState.CLOSING;

        this.removeListenersOnceClosed = true;
        this.internalEventEmitter.removeAllListeners();
    }

    private closed() {
        this.tcpServer = undefined;
        this.tcpPort = undefined;

        this.state = ServerState.UNINITIALIZED;
    }

}

export type IdentificationCallback = (identifiedSession?: PreparedDataStreamSession) => void;

export const enum DataStreamConnectionEvent {
    /**
     * This event is emitted when the first HDSFrame is received from a new connection.
     * The connection expects the handler to identify the connection by trying to match the decryption keys.
     * If identification was successful the PreparedDataStreamSession should be supplied to the callback,
     * otherwise undefined should be supplied.
     */
    IDENTIFICATION = "identification",
    /**
     * This event is emitted when no handler could be found for the given protocol of a event or request message.
     */
    HANDLE_MESSAGE_GLOBALLY = "handle-message-globally",
    /**
     * This event is emitted when the socket of the connection was closed.
     */
    CLOSED = "closed",
}

export declare interface DataStreamConnection {
    on(event: "identification", listener: (frame: HDSFrame, callback: IdentificationCallback) => void): this;
    on(event: "handle-message-globally", listener: (message: DataStreamMessage) => void): this;
    on(event: "closed", listener: () => void): this;

    emit(event: "identification", frame: HDSFrame, callback: IdentificationCallback): boolean;
    emit(event: "handle-message-globally", message: DataStreamMessage): boolean;
    emit(event: "closed"): boolean;
}

/**
 * DataStream connection which holds any necessary state information, encryption an decryption keys, manages
 * protocol handlers and also handles sending and receiving of data stream frames.
 */
export class DataStreamConnection extends EventEmitter {

    private static readonly MAX_PAYLOAD_LENGTH = 0b11111111111111111111;

    private socket: Socket;
    private connection?: HAPConnection; // reference to the hap connection. is present when state > UNIDENTIFIED
    readonly remoteAddress: string;
    /*
        Since our DataStream server does only listen on one port and this port is supplied to every client
        which wants to connect, we do not really know which client is who when we receive a tcp connection.
        Thus, we find the correct PreparedDataStreamSession object by testing the encryption keys of all available
        prepared sessions. Then we can reference this hds connection with the correct hap connection and mark it as identified.
     */
    private state: ConnectionState = ConnectionState.UNIDENTIFIED;

    private accessoryToControllerEncryptionKey?: Buffer;
    private controllerToAccessoryEncryptionKey?: Buffer;

    private accessoryToControllerNonce: number;
    private readonly accessoryToControllerNonceBuffer: Buffer;
    private controllerToAccessoryNonce: number;
    private readonly controllerToAccessoryNonceBuffer: Buffer;

    private frameBuffer?: Buffer; // used to store incomplete HDS frames

    private readonly hapConnectionClosedListener: () => void;
    private protocolHandlers: Record<string, DataStreamProtocolHandler> = {}; // used to store protocolHandlers identified by their protocol name

    private responseHandlers: Record<number, ResponseHandler> = {}; // used to store responseHandlers indexed by their respective requestId
    private responseTimers: Record<number, NodeJS.Timeout> = {}; // used to store response timeouts indexed by their respective requestId

    private helloTimer?: NodeJS.Timeout;

    constructor(socket: Socket) {
        super();
        this.socket = socket;
        this.remoteAddress = socket.remoteAddress!;

        this.socket.setNoDelay(true); // disable Nagle algorithm
        this.socket.setKeepAlive(true);

        this.accessoryToControllerNonce = 0;
        this.accessoryToControllerNonceBuffer = Buffer.alloc(8);
        this.controllerToAccessoryNonce = 0;
        this.controllerToAccessoryNonceBuffer = Buffer.alloc(8);

        this.hapConnectionClosedListener = this.onHAPSessionClosed.bind(this);

        this.addProtocolHandler(Protocols.CONTROL, {
           requestHandler: {
               [Topics.HELLO]: this.handleHello.bind(this)
           }
        });

        this.helloTimer = setTimeout(() => {
            debug("[%s] Hello message did not arrive in time. Killing the connection", this.remoteAddress);
            this.close();
        }, 10000);

        this.socket.on('data', this.onSocketData.bind(this));
        this.socket.on('error', this.onSocketError.bind(this));
        this.socket.on('close', this.onSocketClose.bind(this));
    }

    private handleHello(id: number, _message: Record<any, any>) {
        // that hello is indeed the _first_ message received is verified in onSocketData(...)
        debug("[%s] Received hello message from client", this.remoteAddress);

        clearTimeout(this.helloTimer!);
        this.helloTimer = undefined;

        this.state = ConnectionState.READY;

        this.sendResponse(Protocols.CONTROL, Topics.HELLO, id);
    }

    /**
     * Registers a new protocol handler to handle incoming messages.
     * The same protocol cannot be registered multiple times.
     *
     * @param protocol {string | Protocols} - name of the protocol to register the handler for
     * @param protocolHandler {DataStreamProtocolHandler} - object to be registered as protocol handler
     */
    addProtocolHandler(protocol: string | Protocols, protocolHandler: DataStreamProtocolHandler): boolean {
        if (this.protocolHandlers[protocol] !== undefined) {
            return false;
        }

        this.protocolHandlers[protocol] = protocolHandler;
        return true;
    }

    /**
     * Removes a protocol handler if it is registered.
     *
     * @param protocol {string | Protocols} - name of the protocol to unregister the handler for
     * @param protocolHandler {DataStreamProtocolHandler} - object which will be unregistered
     */
    removeProtocolHandler(protocol: string | Protocols, protocolHandler: DataStreamProtocolHandler) {
        const current = this.protocolHandlers[protocol];

        if (current === protocolHandler) {
            delete this.protocolHandlers[protocol];
        }
    }

    /**
     * Sends a new event message to the connected client.
     *
     * @param protocol {string | Protocols} - name of the protocol
     * @param event {string | Topics} - name of the event (also referred to as topic. See {Topics} for some known ones)
     * @param message {Record<any, any>} - message dictionary which gets sent along the event
     */
    sendEvent(protocol: string | Protocols, event: string | Topics, message: Record<any, any> = {}) {
        const header: Record<any, any> = {};
        header["protocol"] = protocol;
        header["event"] = event;

        this.sendHDSFrame(header, message);
    }

    /**
     * Sends a new request message to the connected client.
     *
     * @param protocol {string | Protocols} - name of the protocol
     * @param request {string | Topics} - name of the request (also referred to as topic. See {Topics} for some known ones)
     * @param message {Record<any, any>} - message dictionary which gets sent along the request
     * @param callback {ResponseHandler} - handler which gets supplied with an error object if the response didn't
     *                                     arrive in time or the status and the message dictionary from the response
     */
    sendRequest(protocol: string | Protocols, request: string | Topics, message: Record<any, any> = {}, callback: ResponseHandler) {
        let requestId: number;
        do { // generate unused requestId
            // currently writing int64 to data stream is not really supported, so 32-bit int will be the max
            requestId = Math.floor(Math.random() * 4294967295);
        } while (this.responseHandlers[requestId] !== undefined);

        this.responseHandlers[requestId] = callback;
        this.responseTimers[requestId] = setTimeout(() => {
            // we did not receive a response => close socket
            this.close();

            const handler = this.responseHandlers[requestId];

            delete this.responseHandlers[requestId];
            delete this.responseTimers[requestId];

            // handler should be able to cleanup their stuff
            handler(new Error("timeout"), undefined, {});
        }, 10000); // 10s timer

        const header: Record<any, any> = {};
        header["protocol"] = protocol;
        header["request"] = request;
        header["id"] = new Int64(requestId);

        this.sendHDSFrame(header, message);
    }

    /**
     * Send a new response message to a received request message to the client.
     *
     * @param protocol {string | Protocols} - name of the protocol
     * @param response {string | Topics} - name of the response (also referred to as topic. See {Topics} for some known ones)
     * @param id {number} - id from the request, to associate the response to the request
     * @param status {HDSStatus} - status indication if the request was successful. A status of zero indicates success.
     * @param message {Record<any, any>} - message dictionary which gets sent along the response
     */
    sendResponse(protocol: string | Protocols, response: string | Topics, id: number, status: HDSStatus = HDSStatus.SUCCESS, message: Record<any, any> = {}) {
        const header: Record<any, any> = {};
        header["protocol"] = protocol;
        header["response"] = response;
        header["id"] = new Int64(id);
        header["status"] = new Int64(status);

        this.sendHDSFrame(header, message);
    }

    private onSocketData(data: Buffer) {
        if (this.state >= ConnectionState.CLOSING) {
            return;
        }

        let frameIndex = 0;
        const frames: HDSFrame[] = this.decodeHDSFrames(data);
        if (frames.length === 0) { // not enough data
            return;
        }

        if (this.state === ConnectionState.UNIDENTIFIED) {
            // at the beginning we are only interested in trying to decrypt the first frame in order to test decryption keys
            const firstFrame = frames[frameIndex++];
            this.emit(DataStreamConnectionEvent.IDENTIFICATION, firstFrame, (identifiedSession?: PreparedDataStreamSession) => {
               if (identifiedSession) {
                   // horray, we found our connection
                   this.connection = identifiedSession.connection;
                   this.accessoryToControllerEncryptionKey = identifiedSession.accessoryToControllerEncryptionKey;
                   this.controllerToAccessoryEncryptionKey = identifiedSession.controllerToAccessoryEncryptionKey;
                   this.state = ConnectionState.EXPECTING_HELLO;

                   // below listener is removed in .close()
                   this.connection.on(HAPConnectionEvent.CLOSED, this.hapConnectionClosedListener); // register close listener
               }
            });

            if (this.state === ConnectionState.UNIDENTIFIED) {
                // did not find a prepared connection, server already closed this connection; nothing to do here
                return;
            }
        }

        for (; frameIndex < frames.length; frameIndex++) { // decrypt all remaining frames
            if (!this.decryptHDSFrame(frames[frameIndex])) {
                debug("[%s] HDS frame decryption or authentication failed. Connection will be terminated!", this.remoteAddress);
                this.close();
                return;
            }
        }

        const messages: DataStreamMessage[] = this.decodePayloads(frames); // decode contents of payload

        if (this.state === ConnectionState.EXPECTING_HELLO) {
            const firstMessage = messages[0];

            if (firstMessage.protocol !== Protocols.CONTROL || firstMessage.type !== MessageType.REQUEST || firstMessage.topic !== Topics.HELLO) {
                // first message is not the expected hello request
                debug("[%s] First message received was not the expected hello message. Instead got: %o", this.remoteAddress, firstMessage);
                this.close();
                return;
            }
        }

        messages.forEach(message => {
            if (message.type === MessageType.RESPONSE) {
                // protocol and topic are currently not tested here; just assumed their are correct;
                // probably they are as the requestId is unique per connection no matter what protocol is used
                const responseHandler = this.responseHandlers[message.id!];
                const responseTimer = this.responseTimers[message.id!];

                if (responseTimer) {
                    clearTimeout(responseTimer);
                    delete this.responseTimers[message.id!];
                }

                if (!responseHandler) {
                    // we got a response to a request we did not send; we ignore it for now, since nobody will be hurt
                    debug("WARNING we received a response to a request we have not sent: %o", message);
                    return;
                }

                try {
                    responseHandler(undefined, message.status!, message.message);
                } catch (error) {
                    debug("[%s] Error occurred while dispatching response handler for HDS message: %o", this.remoteAddress, message);
                    debug(error.stack);
                }
                delete this.responseHandlers[message.id!];
            } else {
                const handler = this.protocolHandlers[message.protocol];
                if (handler === undefined) {
                    // send message to the server to check if there are some global handlers for it
                    this.emit(DataStreamConnectionEvent.HANDLE_MESSAGE_GLOBALLY, message);
                    return;
                }

                if (message.type === MessageType.EVENT) {
                    let eventHandler: EventHandler;
                    if (!handler.eventHandler || !(eventHandler = handler.eventHandler[message.topic])) {
                        debug("[%s] WARNING no event handler was found for message: %o", this.remoteAddress, message);
                        return;
                    }

                    try {
                        eventHandler(message.message);
                    } catch (error) {
                        debug("[%s] Error occurred while dispatching event handler for HDS message: %o", this.remoteAddress, message);
                        debug(error.stack);
                    }
                } else if (message.type === MessageType.REQUEST) {
                    let requestHandler: RequestHandler;
                    if (!handler.requestHandler || !(requestHandler = handler.requestHandler[message.topic])) {
                        debug("[%s] WARNING no request handler was found for message: %o", this.remoteAddress, message);
                        return;
                    }

                    try {
                        requestHandler(message.id!, message.message);
                    } catch (error) {
                        debug("[%s] Error occurred while dispatching request handler for HDS message: %o", this.remoteAddress, message);
                        debug(error.stack);
                    }
                } else {
                    debug("[%s] Encountered unknown message type with id %d", this.remoteAddress, message.type);
                }
            }
        })
    }

    private decodeHDSFrames(data: Buffer) {
        if (this.frameBuffer !== undefined) {
            data = Buffer.concat([this.frameBuffer, data]);
            this.frameBuffer = undefined;
        }

        const totalBufferLength = data.length;
        const frames: HDSFrame[] = [];

        for (let frameBegin = 0; frameBegin < totalBufferLength;) {
            if (frameBegin + 4 > totalBufferLength) {
                // we don't have enough data in the buffer for the next header
                this.frameBuffer = data.slice(frameBegin);
                break;
            }

            const payloadType = data.readUInt8(frameBegin); // type defining structure of payload; 8-bit; currently expected to be 1
            const payloadLength = data.readUIntBE(frameBegin + 1, 3); // read 24-bit big-endian uint length field

            if (payloadLength > DataStreamConnection.MAX_PAYLOAD_LENGTH) {
                debug("[%s] Connection send payload with size bigger than the maximum allow for data stream", this.remoteAddress);
                this.close();
                return [];
            }

            const remainingBufferLength = totalBufferLength - frameBegin - 4; // subtract 4 for payloadType (1-byte) and payloadLength (3-byte)
            // check if the data from this frame is already there (payload + 16-byte authTag)
            if (payloadLength + 16 > remainingBufferLength) {
                // Frame is fragmented, so we wait until we receive more
                this.frameBuffer = data.slice(frameBegin);
                break;
            }

            const payloadBegin = frameBegin + 4;
            const authTagBegin = payloadBegin + payloadLength;

            const header = data.slice(frameBegin, payloadBegin); // header is also authenticated using authTag
            const cipheredPayload = data.slice(payloadBegin, authTagBegin);
            const plaintextPayload = Buffer.alloc(payloadLength);
            const authTag = data.slice(authTagBegin, authTagBegin + 16);

            frameBegin = authTagBegin + 16; // move to next frame

            if (payloadType === 1) {
                const hdsFrame: HDSFrame = {
                    header: header,
                    cipheredPayload: cipheredPayload,
                    authTag: authTag,
                };
                frames.push(hdsFrame);
            } else {
                debug("[%s] Encountered unknown payload type %d for payload: %s", this.remoteAddress, plaintextPayload.toString('hex'));
            }
        }

        return frames;
    }

    decryptHDSFrame(frame: HDSFrame, keyOverwrite?: Buffer): boolean {
        hapCrypto.writeUInt64LE(this.controllerToAccessoryNonce, this.controllerToAccessoryNonceBuffer, 0); // update nonce buffer

        const key = keyOverwrite || this.controllerToAccessoryEncryptionKey!;
        try {
            frame.plaintextPayload = hapCrypto.chacha20_poly1305_decryptAndVerify(key, this.controllerToAccessoryNonceBuffer,
              frame.header, frame.cipheredPayload, frame.authTag);
            this.controllerToAccessoryNonce++; // we had a successful encryption, increment the nonce
            return true;
        } catch (error) {
            // frame decryption or authentication failed. Could happen when our guess for a PreparedDataStreamSession is wrong
            return false;
        }
    }

    private decodePayloads(frames: HDSFrame[]) {
        const messages: DataStreamMessage[] = [];

        frames.forEach(frame => {
            const payload = frame.plaintextPayload;
            if (!payload) {
                throw new Error("Reached illegal state. Encountered HDSFrame with wasn't decrypted yet!");
            }

            const headerLength = payload.readUInt8(0);
            const messageLength = payload.length - headerLength - 1;

            const headerBegin = 1;
            const messageBegin = headerBegin + headerLength;

            const headerPayload = new DataStreamReader(payload.slice(headerBegin, headerBegin + headerLength));
            const messagePayload = new DataStreamReader(payload.slice(messageBegin, messageBegin + messageLength));

            let headerDictionary: Record<any, any>;
            let messageDictionary: Record<any, any>;
            try {
                headerDictionary = DataStreamParser.decode(headerPayload);
                headerPayload.finished();
            } catch (error) {
                debug("[%s] Failed to decode header payload: %s", this.remoteAddress, error.message);
                return;
            }

            try {
                messageDictionary = DataStreamParser.decode(messagePayload);
                messagePayload.finished();
            } catch (error) {
                debug("[%s] Failed to decode message payload: %s (header: %o)", this.remoteAddress, error.message, headerDictionary);
                return;
            }

            let type: MessageType;
            const protocol: string = headerDictionary["protocol"];
            let topic: string;
            let id: number | undefined = undefined;
            let status: HDSStatus | undefined = undefined;

            if (headerDictionary["event"] !== undefined) {
                type = MessageType.EVENT;
                topic = headerDictionary["event"];
            } else if (headerDictionary["request"] !== undefined) {
                type = MessageType.REQUEST;
                topic = headerDictionary["request"];
                id = headerDictionary["id"];
            } else if (headerDictionary["response"] !== undefined) {
                type = MessageType.RESPONSE;
                topic = headerDictionary["response"];
                id = headerDictionary["id"];
                status = headerDictionary["status"];
            } else {
                debug("[%s] Encountered unknown payload header format: %o (message: %o)", this.remoteAddress, headerDictionary, messageDictionary);
                return;
            }

            const message: DataStreamMessage = {
                type: type,
                protocol: protocol,
                topic: topic,
                id: id,
                status: status,
                message: messageDictionary,
            };
            messages.push(message);
        });

        return messages;
    }

    private sendHDSFrame(header: Record<any, any>, message: Record<any, any>) {
        if (this.state >= ConnectionState.CLOSING) {
            throw Error("Cannot send message on closing/closed socket!");
        }

        const headerWriter = new DataStreamWriter();
        const messageWriter = new DataStreamWriter();

        DataStreamParser.encode(header, headerWriter);
        DataStreamParser.encode(message, messageWriter);


        const payloadHeaderBuffer = Buffer.alloc(1);
        payloadHeaderBuffer.writeUInt8(headerWriter.length(), 0);
        const payloadBuffer = Buffer.concat([payloadHeaderBuffer, headerWriter.getData(), messageWriter.getData()]);
        if (payloadBuffer.length > DataStreamConnection.MAX_PAYLOAD_LENGTH) {
            throw new Error("Tried sending payload with length larger than the maximum allowed for data stream");
        }

        const frameTypeBuffer = Buffer.alloc(1);
        frameTypeBuffer.writeUInt8(1, 0);
        let frameLengthBuffer = Buffer.alloc(4);
        frameLengthBuffer.writeUInt32BE(payloadBuffer.length, 0);
        frameLengthBuffer = frameLengthBuffer.slice(1, 4); // a bit hacky but the only real way to write 24-bit int in node

        const frameHeader = Buffer.concat([frameTypeBuffer, frameLengthBuffer]);

        hapCrypto.writeUInt64LE(this.accessoryToControllerNonce++, this.accessoryToControllerNonceBuffer);
        const encrypted = hapCrypto.chacha20_poly1305_encryptAndSeal(this.accessoryToControllerEncryptionKey!, this.accessoryToControllerNonceBuffer, frameHeader, payloadBuffer);

        this.socket.write(Buffer.concat([frameHeader, encrypted.ciphertext, encrypted.authTag]));

        /* Useful for debugging outgoing packages and detecting encoding errors
        console.log("SENT DATA: " + payloadBuffer.toString("hex"));
        const frame: HDSFrame = {
            header: frameHeader,
            plaintextPayload: payloadBuffer,
            cipheredPayload: cipheredPayload,
            authTag: authTag,
        };
        const sentMessage = this.decodePayloads([frame])[0];
        console.log("Sent message: " + JSON.stringify(sentMessage, null, 4));
        //*/
    }

    close() { // closing socket by sending FIN packet; incoming data will be ignored from that point on
        if (this.state >= ConnectionState.CLOSING) {
            return; // connection is already closing/closed
        }

        this.connection?.removeListener(HAPConnectionEvent.CLOSED, this.hapConnectionClosedListener);

        this.state = ConnectionState.CLOSING;
        this.socket.end();
    }

    private onHAPSessionClosed() {
        // If the hap connection is closed it is probably also a good idea to close the data stream connection
        debug("[%s] HAP connection disconnected. Also closing DataStream connection now.", this.remoteAddress);
        this.close();
    }

    private onSocketError(error: Error) {
        debug("[%s] Encountered socket error: %s", this.remoteAddress, error.message);
        // onSocketClose will be called next
    }

    private onSocketClose() {
        // this instance is now considered completely dead
        this.state = ConnectionState.CLOSED;
        this.emit(DataStreamConnectionEvent.CLOSED);
        this.removeAllListeners();
    }

}
