import createDebug from "debug";
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback } from "../Characteristic";
import type { DataStreamTransportManagement } from "../definitions";
import { HAPStatus } from "../HAPServer";
import { Service } from "../Service";
import { HAPConnection } from "../util/eventedhttp";
import * as tlv from '../util/tlv';
import {
    DataStreamConnection,
    DataStreamServer,
    DataStreamServerEvent,
    GlobalEventHandler,
    GlobalRequestHandler
} from "./DataStreamServer";

const debug = createDebug('HAP-NodeJS:DataStream:Management');

const enum TransferTransportConfigurationTypes {
    TRANSFER_TRANSPORT_CONFIGURATION = 1,
}

const enum TransportTypeTypes {
    TRANSPORT_TYPE = 1,
}


const enum SetupDataStreamSessionTypes {
    SESSION_COMMAND_TYPE = 1,
    TRANSPORT_TYPE = 2,
    CONTROLLER_KEY_SALT = 3,
}

const enum SetupDataStreamWriteResponseTypes {
    STATUS = 1,
    TRANSPORT_TYPE_SESSION_PARAMETERS = 2,
    ACCESSORY_KEY_SALT = 3,
}

const enum TransportSessionConfiguration {
    TCP_LISTENING_PORT = 1,
}


enum TransportType {
    HOMEKIT_DATA_STREAM = 0,
}

enum SessionCommandType {
    START_SESSION = 0,
}

export const enum DataStreamStatus {
    SUCCESS = 0,
    GENERIC_ERROR = 1,
    BUSY = 2, // maximum numbers of sessions
}


export class DataStreamManagement {

    // one server per accessory is probably the best practice
    private readonly dataStreamServer: DataStreamServer = new DataStreamServer(); // TODO how to handle Remote+future HKSV controller at the same time?

    private readonly dataStreamTransportManagementService: DataStreamTransportManagement;

    private readonly supportedDataStreamTransportConfiguration: string;
    private lastSetupDataStreamTransportResponse: string = ""; // stripped. excludes ACCESSORY_KEY_SALT

    constructor(service?: DataStreamTransportManagement) {
        const supportedConfiguration: TransportType[] = [TransportType.HOMEKIT_DATA_STREAM];
        this.supportedDataStreamTransportConfiguration = this.buildSupportedDataStreamTransportConfigurationTLV(supportedConfiguration);

        this.dataStreamTransportManagementService = service || this.constructService();
        this.setupServiceHandlers();
    }

    public destroy(): void {
        this.dataStreamServer.destroy(); // removes ALL listeners
        this.dataStreamTransportManagementService.getCharacteristic(Characteristic.SetupDataStreamTransport)
          .removeOnGet()
          .removeAllListeners(CharacteristicEventTypes.SET);
        this.lastSetupDataStreamTransportResponse = "";
    }

    /**
     * @returns the DataStreamTransportManagement service
     */
    getService(): DataStreamTransportManagement {
        return this.dataStreamTransportManagementService;
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
    onEventMessage(protocol: string, event: string, handler: GlobalEventHandler): this {
        this.dataStreamServer.onEventMessage(protocol, event, handler);
        return this;
    }

    /**
     * Removes an registered event handler.
     *
     * @param protocol {string | Protocols} - name of the protocol to unregister the handler for
     * @param event {string | Topics} - name of the event (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalEventHandler} - registered event handler
     */
    removeEventHandler(protocol: string, event: string, handler: GlobalEventHandler): this {
        this.dataStreamServer.removeEventHandler(protocol, event, handler);
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
    onRequestMessage(protocol: string, request: string, handler: GlobalRequestHandler): this {
        this.dataStreamServer.onRequestMessage(protocol, request, handler);
        return this;
    }

    /**
     * Removes an registered request handler.
     *
     * @param protocol {string | Protocols} - name of the protocol to unregister the handler for
     * @param request {string | Topics} - name of the request (also referred to as topic. See {Topics} for some known ones)
     * @param handler {GlobalRequestHandler} - registered request handler
     */
    removeRequestHandler(protocol: string, request: string, handler: GlobalRequestHandler): this {
        this.dataStreamServer.removeRequestHandler(protocol, request, handler);
        return this;
    }

    /**
     * Forwards any event listener for an DataStreamServer event to the DataStreamServer instance
     *
     * @param event - the event to register for
     * @param listener - the event handler
     */
    onServerEvent(event: DataStreamServerEvent, listener: (connection: DataStreamConnection) => void): this {
        // @ts-expect-error
        this.dataStreamServer.on(event, listener);
        return this;
    }

    private handleSetupDataStreamTransportWrite(value: any, callback: CharacteristicSetCallback, connection: HAPConnection) {
        const data = Buffer.from(value, 'base64');
        const objects = tlv.decode(data);

        const sessionCommandType = objects[SetupDataStreamSessionTypes.SESSION_COMMAND_TYPE][0];
        const transportType = objects[SetupDataStreamSessionTypes.TRANSPORT_TYPE][0];
        const controllerKeySalt = objects[SetupDataStreamSessionTypes.CONTROLLER_KEY_SALT];

        debug("Received setup write with command %s and transport type %s", SessionCommandType[sessionCommandType], TransportType[transportType]);

        if (sessionCommandType === SessionCommandType.START_SESSION) {
            if (transportType !== TransportType.HOMEKIT_DATA_STREAM || controllerKeySalt.length !== 32) {
                callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
                return;
            }

            this.dataStreamServer.prepareSession(connection, controllerKeySalt, (error, preparedSession) => {
                if (error || !preparedSession) {
                    callback(error ?? new Error("PreparedSession was undefined!"));
                    return;
                }

                const listeningPort = tlv.encode(TransportSessionConfiguration.TCP_LISTENING_PORT, tlv.writeUInt16(preparedSession.port!));

                let response: Buffer = Buffer.concat([
                    tlv.encode(SetupDataStreamWriteResponseTypes.STATUS, DataStreamStatus.SUCCESS),
                    tlv.encode(SetupDataStreamWriteResponseTypes.TRANSPORT_TYPE_SESSION_PARAMETERS, listeningPort)
                ]);
                this.lastSetupDataStreamTransportResponse = response.toString('base64'); // save last response without accessory key salt

                response = Buffer.concat([
                    response,
                    tlv.encode(SetupDataStreamWriteResponseTypes.ACCESSORY_KEY_SALT, preparedSession.accessoryKeySalt)
                ]);
                callback(null, response.toString('base64'));
            });
        } else {
            callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
            return;
        }
    }

    private buildSupportedDataStreamTransportConfigurationTLV(supportedConfiguration: TransportType[]): string {
        const buffers: Buffer[] = [];
        supportedConfiguration.forEach(type => {
           const transportType = tlv.encode(TransportTypeTypes.TRANSPORT_TYPE, type);
           const transferTransportConfiguration = tlv.encode(TransferTransportConfigurationTypes.TRANSFER_TRANSPORT_CONFIGURATION, transportType);

           buffers.push(transferTransportConfiguration);
        });

        return Buffer.concat(buffers).toString('base64');
    }

    private constructService(): DataStreamTransportManagement {
        const dataStreamTransportManagement = new Service.DataStreamTransportManagement('', '');

        dataStreamTransportManagement.setCharacteristic(Characteristic.SupportedDataStreamTransportConfiguration, this.supportedDataStreamTransportConfiguration);
        dataStreamTransportManagement.setCharacteristic(Characteristic.Version, DataStreamServer.version);

        return dataStreamTransportManagement;
    }

    private setupServiceHandlers() {
        this.dataStreamTransportManagementService.getCharacteristic(Characteristic.SetupDataStreamTransport)
          .onGet(() => this.lastSetupDataStreamTransportResponse)
          .on(CharacteristicEventTypes.SET, (value, callback, context, connection) => {
              if (!connection) {
                  debug("Set event handler for SetupDataStreamTransport cannot be called from plugin! Connection undefined!");
                  callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
                  return;
              }
              this.handleSetupDataStreamTransportWrite(value, callback, connection);
          })
          .updateValue(this.lastSetupDataStreamTransportResponse);
    }

}
