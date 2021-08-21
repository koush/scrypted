import assert from 'assert';
import createDebug from 'debug';
import { EventEmitter } from "events";
import { CharacteristicValue } from "../../types";
import { Accessory } from "../Accessory";
import {
    Characteristic,
    CharacteristicEventTypes,
    CharacteristicGetCallback,
    CharacteristicSetCallback
} from "../Characteristic";
import {
    DataSendCloseReason,
    DataStreamConnection,
    DataStreamConnectionEvent,
    DataStreamManagement,
    DataStreamProtocolHandler,
    DataStreamServerEvent,
    EventHandler,
    Float32,
    HDSStatus,
    Int64,
    Protocols,
    RequestHandler,
    Topics
} from "../datastream";
import type {
    AudioStreamManagement,
    DataStreamTransportManagement,
    Siri,
    TargetControl,
    TargetControlManagement
} from '../definitions';
import { HAPStatus } from "../HAPServer";
import { Service } from "../Service";
import { HAPConnection, HAPConnectionEvent } from "../util/eventedhttp";
import * as tlv from '../util/tlv';
import {
    ControllerIdentifier,
    ControllerServiceMap,
    DefaultControllerType,
    SerializableController,
    StateChangeDelegate
} from "./Controller";


const debug = createDebug('HAP-NodeJS:Remote:Controller');

const enum TargetControlCommands {
    MAXIMUM_TARGETS = 0x01,
    TICKS_PER_SECOND = 0x02,
    SUPPORTED_BUTTON_CONFIGURATION = 0x03,
    TYPE = 0x04
}

const enum SupportedButtonConfigurationTypes {
    BUTTON_ID = 0x01,
    BUTTON_TYPE = 0x02
}

export const enum ButtonType {
    // noinspection JSUnusedGlobalSymbols
    UNDEFINED = 0x00,
    MENU = 0x01,
    PLAY_PAUSE = 0x02,
    TV_HOME = 0x03,
    SELECT = 0x04,
    ARROW_UP = 0x05,
    ARROW_RIGHT = 0x06,
    ARROW_DOWN = 0x07,
    ARROW_LEFT = 0x08,
    VOLUME_UP = 0x09,
    VOLUME_DOWN = 0x0A,
    SIRI = 0x0B,
    POWER = 0x0C,
    GENERIC = 0x0D
}


const enum TargetControlList {
    OPERATION = 0x01,
    TARGET_CONFIGURATION = 0x02
}

enum Operation {
    // noinspection JSUnusedGlobalSymbols
    UNDEFINED = 0x00,
    LIST = 0x01,
    ADD = 0x02,
    REMOVE = 0x03,
    RESET = 0x04,
    UPDATE = 0x05
}

const enum TargetConfigurationTypes {
    TARGET_IDENTIFIER = 0x01,
    TARGET_NAME = 0x02,
    TARGET_CATEGORY = 0x03,
    BUTTON_CONFIGURATION = 0x04
}

export const enum TargetCategory {
    // noinspection JSUnusedGlobalSymbols
    UNDEFINED = 0x00,
    APPLE_TV = 0x18
}

const enum ButtonConfigurationTypes {
    BUTTON_ID = 0x01,
    BUTTON_TYPE = 0x02,
    BUTTON_NAME = 0x03,
}

const enum ButtonEvent {
    BUTTON_ID = 0x01,
    BUTTON_STATE = 0x02,
    TIMESTAMP = 0x03,
    ACTIVE_IDENTIFIER = 0x04,
}

export const enum ButtonState {
    UP = 0x00,
    DOWN = 0x01
}


export type SupportedConfiguration = {
    maximumTargets: number,
    ticksPerSecond: number,
    supportedButtonConfiguration: SupportedButtonConfiguration[],
    hardwareImplemented: boolean
}

export type SupportedButtonConfiguration = {
    buttonID: number,
    buttonType: ButtonType
}

export type TargetConfiguration = {
    targetIdentifier: number,
    targetName?: string, // on Operation.UPDATE targetName is left out
    targetCategory?: TargetCategory, // on Operation.UPDATE targetCategory is left out
    buttonConfiguration: Record<number, ButtonConfiguration> // button configurations indexed by their ID
}

export type ButtonConfiguration = {
    buttonID: number,
    buttonType: ButtonType,
    buttonName?: string
}


const enum SelectedAudioInputStreamConfigurationTypes {
    SELECTED_AUDIO_INPUT_STREAM_CONFIGURATION = 0x01,
}

// ----------

const enum SupportedAudioStreamConfigurationTypes {
    // noinspection JSUnusedGlobalSymbols
    AUDIO_CODEC_CONFIGURATION = 0x01,
    COMFORT_NOISE_SUPPORT = 0x02,
}

const enum AudioCodecConfigurationTypes {
    CODEC_TYPE = 0x01,
    CODEC_PARAMETERS = 0x02,
}

export const enum AudioCodecTypes { // only really by HAP supported codecs are AAC-ELD and OPUS
    // noinspection JSUnusedGlobalSymbols
    PCMU = 0x00,
    PCMA = 0x01,
    AAC_ELD = 0x02,
    OPUS = 0x03,
    MSBC = 0x04, // mSBC is a bluetooth codec (lol)
    AMR = 0x05,
    AMR_WB = 0x06,
}

const enum AudioCodecParametersTypes {
    CHANNEL = 0x01,
    BIT_RATE = 0x02,
    SAMPLE_RATE = 0x03,
    PACKET_TIME = 0x04 // only present in selected audio codec parameters tlv
}

export const enum AudioBitrate {
    VARIABLE = 0x00,
    CONSTANT = 0x01
}

export const enum AudioSamplerate {
    KHZ_8 = 0x00,
    KHZ_16 = 0x01,
    KHZ_24 = 0x02
    // 3, 4, 5 are theoretically defined, but no idea to what kHz value they correspond to
    // probably KHZ_32, KHZ_44_1, KHZ_48 (as supported by Secure Video recordings)
}

// ----------

type SupportedAudioStreamConfiguration = {
    audioCodecConfiguration: AudioCodecConfiguration,
}

type SelectedAudioStreamConfiguration = {
    audioCodecConfiguration: AudioCodecConfiguration,
}

export type AudioCodecConfiguration = {
    codecType: AudioCodecTypes,
    parameters: AudioCodecParameters,
}

export type AudioCodecParameters = {
    channels: number, // number of audio channels, default is 1
    bitrate: AudioBitrate,
    samplerate: AudioSamplerate,
    rtpTime?: RTPTime, // only present in SelectedAudioCodecParameters TLV
}

export type RTPTime = 20 | 30 | 40 | 60;


const enum SiriAudioSessionState {
    STARTING = 0, // we are currently waiting for a response for the start request
    SENDING = 1, // we are sending data
    CLOSING = 2, // we are currently waiting for the acknowledgment event
    CLOSED = 3, // the close event was sent
}

type DataSendMessageData = {
    packets: AudioFramePacket[],
    streamId: Int64,
    endOfStream: boolean,
}

export type AudioFrame = {
    data: Buffer,
    rms: number, // root mean square
}

type AudioFramePacket = {
    data: Buffer,
    metadata: {
        rms: Float32, // root mean square
        sequenceNumber: Int64,
    },
}


export type FrameHandler = (frame: AudioFrame) => void;
export type ErrorHandler = (error: DataSendCloseReason) => void;

export interface SiriAudioStreamProducer {

    startAudioProduction(selectedAudioConfiguration: AudioCodecConfiguration): void;

    stopAudioProduction(): void;

}

export interface SiriAudioStreamProducerConstructor {

    /**
     * Creates a new instance of a SiriAudioStreamProducer
     *
     * @param frameHandler {FrameHandler} - called for every opus frame recorded
     * @param errorHandler {ErrorHandler} - should be called with a appropriate reason when the producing process errored
     * @param options - optional parameter for passing any configuration related options
     */
    new(frameHandler: FrameHandler, errorHandler: ErrorHandler, options?: any): SiriAudioStreamProducer;

}

export const enum TargetUpdates {
    NAME,
    CATEGORY,
    UPDATED_BUTTONS,
    REMOVED_BUTTONS,
}

export const enum RemoteControllerEvents {
    /**
     * This event is emitted when the active state of the remote has changed.
     * active = true indicates that there is currently an apple tv listening of button presses and audio streams.
     */
    ACTIVE_CHANGE = "active-change",
    /**
     * This event is emitted when the currently selected target has changed.
     * Possible reasons for a changed active identifier: manual change via api call, first target configuration
     * gets added, active target gets removed, accessory gets unpaired, reset request was sent.
     * An activeIdentifier of 0 indicates that no target is selected.
     */
    ACTIVE_IDENTIFIER_CHANGE = "active-identifier-change",

    /**
     * This event is emitted when a new target configuration is received. As we currently do not persistently store
     * configured targets, this will be called at every startup for every Apple TV configured in the home.
     */
    TARGET_ADDED = "target-add",
    /**
     * This event is emitted when a existing target was updated.
     * The 'updates' array indicates what exactly was changed for the target.
     */
    TARGET_UPDATED = "target-update",
    /**
     * This event is emitted when a existing configuration for a target was removed.
     */
    TARGET_REMOVED = "target-remove",
    /**
     * This event is emitted when a reset of the target configuration is requested.
     * With this event every configuration made should be reset. This event is also called
     * when the accessory gets unpaired.
     */
    TARGETS_RESET = "targets-reset",
}

export declare interface RemoteController {
    on(event: "active-change", listener: (active: boolean) => void): this;
    on(event: "active-identifier-change", listener: (activeIdentifier: number) => void): this;

    on(event: "target-add", listener: (targetConfiguration: TargetConfiguration) => void): this;
    on(event: "target-update", listener: (targetConfiguration: TargetConfiguration, updates: TargetUpdates[]) => void): this;
    on(event: "target-remove", listener: (targetIdentifier: number) => void): this;
    on(event: "targets-reset", listener: () => void): this;

    emit(event: "active-change", active: boolean): boolean;
    emit(event: "active-identifier-change", activeIdentifier: number): boolean;

    emit(event: "target-add", targetConfiguration: TargetConfiguration): boolean;
    emit(event: "target-update", targetConfiguration: TargetConfiguration, updates: TargetUpdates[]): boolean;
    emit(event: "target-remove", targetIdentifier: number): boolean;
    emit(event: "targets-reset"): boolean;
}

interface RemoteControllerServiceMap extends ControllerServiceMap {
    targetControlManagement: TargetControlManagement,
    targetControl: TargetControl,

    siri?: Siri,
    audioStreamManagement?: AudioStreamManagement,
    dataStreamTransportManagement?: DataStreamTransportManagement
}

interface SerializedControllerState {
    activeIdentifier: number,
    targetConfigurations: Record<number, TargetConfiguration>;
}

/**
 * Handles everything needed to implement a fully working HomeKit remote controller.
 */
export class RemoteController extends EventEmitter implements SerializableController<RemoteControllerServiceMap, SerializedControllerState>, DataStreamProtocolHandler {

    private stateChangeDelegate?: StateChangeDelegate;

    private readonly audioSupported: boolean;
    private readonly audioProducerConstructor?: SiriAudioStreamProducerConstructor;
    private readonly audioProducerOptions?: any;

    private targetControlManagementService?: TargetControlManagement;
    private targetControlService?: TargetControl;

    private siriService?: Siri;
    private audioStreamManagementService?: AudioStreamManagement;
    private dataStreamManagement?: DataStreamManagement;

    private buttons: Record<number, number> = {}; // internal mapping of buttonId to buttonType for supported buttons
    private readonly supportedConfiguration: string;
    targetConfigurations: Map<number, TargetConfiguration> = new Map();
    private  targetConfigurationsString: string = "";

    private lastButtonEvent: string = "";

    activeIdentifier: number = 0; // id of 0 means no device selected
    private activeConnection?: HAPConnection; // session which marked this remote as active and listens for events and siri
    private activeConnectionDisconnectListener?: () => void;

    private readonly supportedAudioConfiguration: string;
    private selectedAudioConfiguration: AudioCodecConfiguration;
    private selectedAudioConfigurationString: string;

    private dataStreamConnections: Map<number, DataStreamConnection> = new Map(); // maps targetIdentifiers to active data stream connections
    private activeAudioSession?: SiriAudioSession;
    private nextAudioSession?: SiriAudioSession;

    /**
     * @private
     */
    eventHandler?: Record<string, EventHandler>;
    /**
     * @private
     */
    requestHandler?: Record<string, RequestHandler>;

    /**
     * Creates a new RemoteController.
     * If siri voice input is supported the constructor to an SiriAudioStreamProducer needs to be supplied.
     * Otherwise a remote without voice support will be created.
     *
     * For every audio session a new SiriAudioStreamProducer will be constructed.
     *
     * @param audioProducerConstructor {SiriAudioStreamProducerConstructor} - constructor for a SiriAudioStreamProducer
     * @param producerOptions - if supplied this argument will be supplied as third argument of the SiriAudioStreamProducer
     *                          constructor. This should be used to supply configurations to the stream producer.
     */
    public constructor(audioProducerConstructor?: SiriAudioStreamProducerConstructor, producerOptions?: any) {
        super();
        this.audioSupported = audioProducerConstructor !== undefined;
        this.audioProducerConstructor = audioProducerConstructor;
        this.audioProducerOptions = producerOptions;

        const configuration: SupportedConfiguration = this.constructSupportedConfiguration();
        this.supportedConfiguration = this.buildTargetControlSupportedConfigurationTLV(configuration);

        const audioConfiguration: SupportedAudioStreamConfiguration = this.constructSupportedAudioConfiguration();
        this.supportedAudioConfiguration = RemoteController.buildSupportedAudioConfigurationTLV(audioConfiguration);

        this.selectedAudioConfiguration = { // set the required defaults
            codecType: AudioCodecTypes.OPUS,
            parameters: {
                channels: 1,
                bitrate: AudioBitrate.VARIABLE,
                samplerate: AudioSamplerate.KHZ_16,
                rtpTime: 20,
            }
        };
        this.selectedAudioConfigurationString = RemoteController.buildSelectedAudioConfigurationTLV({
            audioCodecConfiguration: this.selectedAudioConfiguration,
        });
    }

    /**
     * @private
     */
    controllerId(): ControllerIdentifier {
        return DefaultControllerType.REMOTE;
    }

    /**
     * Set a new target as active target. A value of 0 indicates that no target is selected currently.
     *
     * @param activeIdentifier {number} - target identifier
     */
    public setActiveIdentifier(activeIdentifier: number): void {
        if (activeIdentifier === this.activeIdentifier) {
            return;
        }

        if (activeIdentifier !== 0 && !this.targetConfigurations.has(activeIdentifier)) {
            throw Error("Tried setting unconfigured targetIdentifier to active");
        }

        debug("%d is now the active target", activeIdentifier);
        this.activeIdentifier = activeIdentifier;
        this.targetControlService!.getCharacteristic(Characteristic.ActiveIdentifier)!.updateValue(activeIdentifier);

        if (this.activeAudioSession) {
            this.handleSiriAudioStop();
        }

        setTimeout(() => this.emit(RemoteControllerEvents.ACTIVE_IDENTIFIER_CHANGE, activeIdentifier), 0);
        this.setInactive();
    }

    /**
     * @returns if the current target is active, meaning the active device is listening for button events or audio sessions
     */
    public isActive(): boolean {
        return !!this.activeConnection;
    }

    /**
     * Checks if the supplied targetIdentifier is configured.
     *
     * @param targetIdentifier {number}
     */
    public isConfigured(targetIdentifier: number): boolean {
        return this.targetConfigurations.has(targetIdentifier);
    }

    /**
     * Returns the targetIdentifier for a give device name
     *
     * @param name {string} - the name of the device
     * @returns the targetIdentifier of the device or undefined if not existent
     */
    public getTargetIdentifierByName(name: string): number | undefined {
        for (const [ activeIdentifier, configuration ] of Object.entries(this.targetConfigurations)) {
            if (configuration.targetName === name) {
                return parseInt(activeIdentifier, 10);
            }
        }

        return undefined;
    }

    /**
     * Sends a button event to press the supplied button.
     *
     * @param button {ButtonType} - button to be pressed
     */
    public pushButton(button: ButtonType): void {
        this.sendButtonEvent(button, ButtonState.DOWN);
    }

    /**
     * Sends a button event that the supplied button was released.
     *
     * @param button {ButtonType} - button which was released
     */
    public releaseButton(button: ButtonType): void {
        this.sendButtonEvent(button, ButtonState.UP);
    }

    /**
     * Presses a supplied button for a given time.
     *
     * @param button {ButtonType} - button to be pressed and released
     * @param time {number} - time in milliseconds (defaults to 200ms)
     */
    public pushAndReleaseButton(button: ButtonType, time: number = 200): void {
        this.pushButton(button);
        setTimeout(() => this.releaseButton(button), time);
    }

    /**
     * This method adds and configures the remote services for a give accessory.
     *
     * @param accessory {Accessory} - the give accessory this remote should be added to
     * @deprecated - use {@link Accessory.configureController} instead
     */
    addServicesToAccessory(accessory: Accessory): void {
        accessory.configureController(this);
    }

    // ---------------------------------- CONFIGURATION ----------------------------------
    // override methods if you would like to change anything (but should not be necessary most likely)

    protected constructSupportedConfiguration(): SupportedConfiguration {
        const configuration: SupportedConfiguration = {
            maximumTargets: 10, // some random number. (ten should be okay?)
            ticksPerSecond: 1000, // we rely on unix timestamps
            supportedButtonConfiguration: [],
            hardwareImplemented: this.audioSupported // siri is only allowed for hardware implemented remotes
        };

        const supportedButtons = [
            ButtonType.MENU, ButtonType.PLAY_PAUSE, ButtonType.TV_HOME, ButtonType.SELECT,
            ButtonType.ARROW_UP, ButtonType.ARROW_RIGHT, ButtonType.ARROW_DOWN, ButtonType.ARROW_LEFT,
            ButtonType.VOLUME_UP, ButtonType.VOLUME_DOWN, ButtonType.POWER, ButtonType.GENERIC
        ];
        if (this.audioSupported) { // add siri button if this remote supports it
            supportedButtons.push(ButtonType.SIRI);
        }

        supportedButtons.forEach(button => {
            const buttonConfiguration: SupportedButtonConfiguration = {
                buttonID: 100 + button,
                buttonType: button
            };
            configuration.supportedButtonConfiguration.push(buttonConfiguration);
            this.buttons[button] = buttonConfiguration.buttonID; // also saving mapping of type to id locally
        });

        return configuration;
    }

    protected constructSupportedAudioConfiguration(): SupportedAudioStreamConfiguration {
        // the following parameters are expected from HomeKit for a remote
        return {
            audioCodecConfiguration: {
                codecType: AudioCodecTypes.OPUS,
                parameters: {
                    channels: 1,
                    bitrate: AudioBitrate.VARIABLE,
                    samplerate: AudioSamplerate.KHZ_16,
                }
            },
        }
    }

    // --------------------------------- TARGET CONTROL ----------------------------------

    private handleTargetControlWrite(value: any, callback: CharacteristicSetCallback): void {
        const data = Buffer.from(value, 'base64');
        const objects = tlv.decode(data);

        const operation = objects[TargetControlList.OPERATION][0] as Operation;

        let targetConfiguration: TargetConfiguration | undefined = undefined;
        if (objects[TargetControlList.TARGET_CONFIGURATION]) { // if target configuration was sent, parse it
            targetConfiguration = this.parseTargetConfigurationTLV(objects[TargetControlList.TARGET_CONFIGURATION]);
        }

        debug("Received TargetControl write operation %s", Operation[operation]);

        let handler: (targetConfiguration?: TargetConfiguration) => HAPStatus;
        switch (operation) {
            case Operation.ADD:
                handler = this.handleAddTarget.bind(this);
                break;
            case Operation.UPDATE:
                handler = this.handleUpdateTarget.bind(this);
                break;
            case Operation.REMOVE:
                handler = this.handleRemoveTarget.bind(this);
                break;
            case Operation.RESET:
                handler = this.handleResetTargets.bind(this);
                break;
            case Operation.LIST:
                handler = this.handleListTargets.bind(this);
                break;
            default:
                callback(HAPStatus.INVALID_VALUE_IN_REQUEST, undefined);
                return;
        }

        const status = handler(targetConfiguration);
        if (status === HAPStatus.SUCCESS) {
            callback(undefined, this.targetConfigurationsString); // passing value for write response

            if (operation === Operation.ADD && this.activeIdentifier === 0) {
                this.setActiveIdentifier(targetConfiguration!.targetIdentifier);
            }
        } else {
            callback(new Error(status + ""));
        }
    }

    private handleAddTarget(targetConfiguration?: TargetConfiguration): HAPStatus {
        if (!targetConfiguration) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        this.targetConfigurations.set(targetConfiguration.targetIdentifier, targetConfiguration);

        debug("Configured new target '" + targetConfiguration.targetName + "' with targetIdentifier '" + targetConfiguration.targetIdentifier + "'");

        setTimeout(() => this.emit(RemoteControllerEvents.TARGET_ADDED, targetConfiguration), 0);

        this.updatedTargetConfiguration(); // set response
        return HAPStatus.SUCCESS;
    }

    private handleUpdateTarget(targetConfiguration?: TargetConfiguration): HAPStatus {
        if (!targetConfiguration) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        const updates: TargetUpdates[] = [];

        const configuredTarget = this.targetConfigurations.get(targetConfiguration.targetIdentifier);
        if (!configuredTarget) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        if (targetConfiguration.targetName) {
            debug("Target name was updated '%s' => '%s' (%d)",
                configuredTarget.targetName, targetConfiguration.targetName, configuredTarget.targetIdentifier);

            configuredTarget.targetName = targetConfiguration.targetName;
            updates.push(TargetUpdates.NAME);
        }
        if (targetConfiguration.targetCategory) {
            debug("Target category was updated '%d' => '%d' for target '%s' (%d)",
                configuredTarget.targetCategory, targetConfiguration.targetCategory,
                configuredTarget.targetName, configuredTarget.targetIdentifier);

            configuredTarget.targetCategory = targetConfiguration.targetCategory;
            updates.push(TargetUpdates.CATEGORY);
        }
        if (targetConfiguration.buttonConfiguration) {
            debug("%d button configurations were updated for target '%s' (%d)",
                Object.keys(targetConfiguration.buttonConfiguration).length,
                configuredTarget.targetName, configuredTarget.targetIdentifier);

            for (const configuration of Object.values(targetConfiguration.buttonConfiguration)) {
                const savedConfiguration = configuredTarget.buttonConfiguration[configuration.buttonID];

                savedConfiguration.buttonType = configuration.buttonType;
                savedConfiguration.buttonName = configuration.buttonName;
            }
            updates.push(TargetUpdates.UPDATED_BUTTONS);
        }

        setTimeout(() => this.emit(RemoteControllerEvents.TARGET_UPDATED, targetConfiguration, updates), 0);

        this.updatedTargetConfiguration(); // set response
        return HAPStatus.SUCCESS;
    }

    private handleRemoveTarget(targetConfiguration?: TargetConfiguration): HAPStatus {
        if (!targetConfiguration) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        const configuredTarget = this.targetConfigurations.get(targetConfiguration.targetIdentifier);
        if (!configuredTarget) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        if (targetConfiguration.buttonConfiguration) {
            for (const key in targetConfiguration.buttonConfiguration) {
                if (Object.prototype.hasOwnProperty.call(targetConfiguration.buttonConfiguration, key)) {
                    delete configuredTarget.buttonConfiguration[key];
                }
            }

            debug("Removed %d button configurations of target '%s' (%d)",
                Object.keys(targetConfiguration.buttonConfiguration).length, configuredTarget.targetName, configuredTarget.targetIdentifier);
            setTimeout(() => this.emit(RemoteControllerEvents.TARGET_UPDATED, configuredTarget, [TargetUpdates.REMOVED_BUTTONS]), 0);
        } else {
            this.targetConfigurations.delete(targetConfiguration.targetIdentifier);

            debug ("Target '%s' (%d) was removed", configuredTarget.targetName, configuredTarget.targetIdentifier);
            setTimeout(() => this.emit(RemoteControllerEvents.TARGET_REMOVED, targetConfiguration.targetIdentifier), 0);

            const keys = Object.keys(this.targetConfigurations);
            this.setActiveIdentifier(keys.length === 0? 0: parseInt(keys[0], 10)); // switch to next available remote
        }

        this.updatedTargetConfiguration(); // set response
        return HAPStatus.SUCCESS;
    }

    private handleResetTargets(targetConfiguration?: TargetConfiguration): HAPStatus {
        if (targetConfiguration) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        debug("Resetting all target configurations");
        this.targetConfigurations = new Map();
        this.updatedTargetConfiguration(); // set response

        setTimeout(() => this.emit(RemoteControllerEvents.TARGETS_RESET), 0);
        this.setActiveIdentifier(0); // resetting active identifier (also sets active to false)

        return HAPStatus.SUCCESS;
    }

    private handleListTargets(targetConfiguration?: TargetConfiguration): HAPStatus {
        if (targetConfiguration) {
            return HAPStatus.INVALID_VALUE_IN_REQUEST;
        }

        // this.targetConfigurationsString is updated after each change, so we basically don't need to do anything here
        debug("Returning " + Object.keys(this.targetConfigurations).length + " target configurations");
        return HAPStatus.SUCCESS;
    }

    private handleActiveWrite(value: CharacteristicValue, callback: CharacteristicSetCallback, connection: HAPConnection): void {
        if (this.activeIdentifier === 0) {
            debug("Tried to change active state. There is no active target set though");
            callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
            return;
        }

        if (this.activeConnection) {
            this.activeConnection.removeListener(HAPConnectionEvent.CLOSED, this.activeConnectionDisconnectListener!);
            this.activeConnection = undefined;
            this.activeConnectionDisconnectListener = undefined;
        }

        this.activeConnection = value? connection: undefined;
        if (this.activeConnection) { // register listener when hap connection disconnects
            this.activeConnectionDisconnectListener = this.handleActiveSessionDisconnected.bind(this, this.activeConnection);
            this.activeConnection.on(HAPConnectionEvent.CLOSED, this.activeConnectionDisconnectListener);
        }

        const activeTarget = this.targetConfigurations.get(this.activeIdentifier);
        if (!activeTarget) {
            callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
            return;
        }

        debug("Remote with activeTarget '%s' (%d) was set to %s", activeTarget.targetName, this.activeIdentifier, value ? "ACTIVE" : "INACTIVE");

        callback();

        this.emit(RemoteControllerEvents.ACTIVE_CHANGE, value as boolean);
    }

    private setInactive(): void {
        if (this.activeConnection === undefined) {
            return;
        }

        this.activeConnection.removeListener(HAPConnectionEvent.CLOSED, this.activeConnectionDisconnectListener!);
        this.activeConnection = undefined;
        this.activeConnectionDisconnectListener = undefined;

        this.targetControlService!.getCharacteristic(Characteristic.Active)!.updateValue(false);
        debug("Remote was set to INACTIVE");

        setTimeout(() => this.emit(RemoteControllerEvents.ACTIVE_CHANGE, false), 0);
    }

    private handleActiveSessionDisconnected(connection: HAPConnection): void {
        if (connection !== this.activeConnection) {
            return;
        }

        debug("Active hap session disconnected!");
        this.setInactive();
    }

    private sendButtonEvent(button: ButtonType, buttonState: ButtonState) {
        const buttonID = this.buttons[button];
        if (buttonID === undefined || buttonID === 0) {
            throw new Error("Tried sending button event for unsupported button (" + button + ")");
        }

        if (this.activeIdentifier === 0) { // cannot press button if no device is selected
            throw new Error("Tried sending button event although no target was selected");
        }

        if (!this.isActive()) { // cannot press button if device is not active (aka no apple tv is listening)
            throw new Error("Tried sending button event although target was not marked as active");
        }

        if (button === ButtonType.SIRI && this.audioSupported) {
            if (buttonState === ButtonState.DOWN) { // start streaming session
                this.handleSiriAudioStart();
            } else if (buttonState === ButtonState.UP) { // stop streaming session
                this.handleSiriAudioStop();
            }
            return;
        }

        const buttonIdTlv = tlv.encode(
            ButtonEvent.BUTTON_ID, buttonID
        );

        const buttonStateTlv = tlv.encode(
            ButtonEvent.BUTTON_STATE, buttonState
        );

        const timestampTlv = tlv.encode(
            ButtonEvent.TIMESTAMP, tlv.writeUInt64(new Date().getTime())
            // timestamp should be uint64. bigint though is only supported by node 10.4.0 and above
            // thus we just interpret timestamp as a regular number
        );

        const activeIdentifierTlv = tlv.encode(
            ButtonEvent.ACTIVE_IDENTIFIER, tlv.writeUInt32(this.activeIdentifier)
        );

        this.lastButtonEvent = Buffer.concat([
            buttonIdTlv, buttonStateTlv, timestampTlv, activeIdentifierTlv
        ]).toString('base64');
        this.targetControlService!.getCharacteristic(Characteristic.ButtonEvent)!.sendEventNotification(this.lastButtonEvent);
    }

    private parseTargetConfigurationTLV(data: Buffer): TargetConfiguration {
        const configTLV = tlv.decode(data);

        const identifier = tlv.readUInt32(configTLV[TargetConfigurationTypes.TARGET_IDENTIFIER]);

        let name = undefined;
        if (configTLV[TargetConfigurationTypes.TARGET_NAME])
            name = configTLV[TargetConfigurationTypes.TARGET_NAME].toString();

        let category = undefined;
        if (configTLV[TargetConfigurationTypes.TARGET_CATEGORY])
            category = tlv.readUInt16(configTLV[TargetConfigurationTypes.TARGET_CATEGORY]);

        const buttonConfiguration: Record<number, ButtonConfiguration> = {};

        if (configTLV[TargetConfigurationTypes.BUTTON_CONFIGURATION]) {
            const buttonConfigurationTLV = tlv.decodeList(configTLV[TargetConfigurationTypes.BUTTON_CONFIGURATION], ButtonConfigurationTypes.BUTTON_ID);
            buttonConfigurationTLV.forEach(entry => {
                const buttonId = entry[ButtonConfigurationTypes.BUTTON_ID][0];
                const buttonType = tlv.readUInt16(entry[ButtonConfigurationTypes.BUTTON_TYPE]);
                let buttonName;
                if (entry[ButtonConfigurationTypes.BUTTON_NAME]) {
                    buttonName = entry[ButtonConfigurationTypes.BUTTON_NAME].toString();
                } else {
                    // @ts-ignore
                    buttonName = ButtonType[buttonType as ButtonType];
                }

                buttonConfiguration[buttonId] = {
                    buttonID: buttonId,
                    buttonType: buttonType,
                    buttonName: buttonName
                };
            });
        }

        return {
            targetIdentifier: identifier,
            targetName: name,
            targetCategory: category,
            buttonConfiguration: buttonConfiguration
        };
    }

    private updatedTargetConfiguration(): void {
        const bufferList = [];
        for (const configuration of Object.values(this.targetConfigurations)) {
            const targetIdentifier = tlv.encode(
                TargetConfigurationTypes.TARGET_IDENTIFIER, tlv.writeUInt32(configuration.targetIdentifier)
            );

            const targetName = tlv.encode(
                TargetConfigurationTypes.TARGET_NAME, configuration.targetName!
            );

            const targetCategory = tlv.encode(
                TargetConfigurationTypes.TARGET_CATEGORY, tlv.writeUInt16(configuration.targetCategory!)
            );

            const buttonConfigurationBuffers: Buffer[] = [];
            for (const value of configuration.buttonConfiguration.values()) {
                let tlvBuffer = tlv.encode(
                    ButtonConfigurationTypes.BUTTON_ID, value.buttonID,
                    ButtonConfigurationTypes.BUTTON_TYPE, tlv.writeUInt16(value.buttonType)
                );

                if (value.buttonName) {
                    tlvBuffer = Buffer.concat([
                        tlvBuffer,
                        tlv.encode(
                            ButtonConfigurationTypes.BUTTON_NAME, value.buttonName
                        )
                    ])
                }

                buttonConfigurationBuffers.push(tlvBuffer);
            }

            const buttonConfiguration = tlv.encode(
                TargetConfigurationTypes.BUTTON_CONFIGURATION, Buffer.concat(buttonConfigurationBuffers)
            );

            const targetConfiguration = Buffer.concat(
                [targetIdentifier, targetName, targetCategory, buttonConfiguration]
            );

            bufferList.push(tlv.encode(TargetControlList.TARGET_CONFIGURATION, targetConfiguration));
        }

        this.targetConfigurationsString = Buffer.concat(bufferList).toString('base64');
        this.stateChangeDelegate && this.stateChangeDelegate();
    }

    private buildTargetControlSupportedConfigurationTLV(configuration: SupportedConfiguration): string {
        const maximumTargets = tlv.encode(
            TargetControlCommands.MAXIMUM_TARGETS, configuration.maximumTargets
        );

        const ticksPerSecond = tlv.encode(
            TargetControlCommands.TICKS_PER_SECOND, tlv.writeUInt64(configuration.ticksPerSecond)
        );

        const supportedButtonConfigurationBuffers: Uint8Array[] = [];
        configuration.supportedButtonConfiguration.forEach(value => {
            const tlvBuffer = tlv.encode(
                SupportedButtonConfigurationTypes.BUTTON_ID, value.buttonID,
                SupportedButtonConfigurationTypes.BUTTON_TYPE, tlv.writeUInt16(value.buttonType)
            );
            supportedButtonConfigurationBuffers.push(tlvBuffer);
        });
        const supportedButtonConfiguration = tlv.encode(
            TargetControlCommands.SUPPORTED_BUTTON_CONFIGURATION, Buffer.concat(supportedButtonConfigurationBuffers)
        );

        const type = tlv.encode(TargetControlCommands.TYPE, configuration.hardwareImplemented ? 1 : 0);

        return Buffer.concat(
            [maximumTargets, ticksPerSecond, supportedButtonConfiguration, type]
        ).toString('base64');
    }

    // --------------------------------- SIRI/DATA STREAM --------------------------------

    private handleTargetControlWhoAmI(connection: DataStreamConnection, message: Record<any, any>): void {
        const targetIdentifier = message["identifier"];
        this.dataStreamConnections.set(targetIdentifier, connection);
        debug("Discovered HDS connection for targetIdentifier %s", targetIdentifier);

        connection.addProtocolHandler(Protocols.DATA_SEND, this);
    }

    private handleSiriAudioStart(): void {
        if (!this.audioSupported) {
            throw new Error("Cannot start siri stream on remote where siri is not supported");
        }

        if (!this.isActive()) {
            debug("Tried opening Siri audio stream, however no controller is connected!");
            return;
        }

        if (this.activeAudioSession && (!this.activeAudioSession.isClosing() || this.nextAudioSession)) {
            // there is already a session running, which is not in closing state and/or there is even already a
            // nextAudioSession running. ignoring start request
            debug("Tried opening Siri audio stream, however there is already one in progress");
            return;
        }

        const connection = this.dataStreamConnections.get(this.activeIdentifier); // get connection for current target
        if (connection === undefined) { // target seems not connected, ignore it
            debug("Tried opening Siri audio stream however target is not connected via HDS");
            return;
        }

        const audioSession = new SiriAudioSession(connection, this.selectedAudioConfiguration, this.audioProducerConstructor!, this.audioProducerOptions);
        if (!this.activeAudioSession) {
            this.activeAudioSession = audioSession;
        } else {
            // we checked above that this only happens if the activeAudioSession is in closing state,
            // so no collision with the input device can happen
            this.nextAudioSession = audioSession;
        }

        audioSession.on(SiriAudioSessionEvents.CLOSE, this.handleSiriAudioSessionClosed.bind(this, audioSession));
        audioSession.start();
    }

    private handleSiriAudioStop(): void {
        if (this.activeAudioSession) {
            if (!this.activeAudioSession.isClosing()) {
                this.activeAudioSession.stop();
                return;
            } else if (this.nextAudioSession && !this.nextAudioSession.isClosing()) {
                this.nextAudioSession.stop();
                return;
            }
        }

        debug("handleSiriAudioStop called although no audio session was started");
    }

    private handleDataSendAckEvent(message: Record<any, any>): void { // transfer was successful
        const streamId = message["streamId"];
        const endOfStream = message["endOfStream"];

        if (this.activeAudioSession && this.activeAudioSession.streamId === streamId) {
            this.activeAudioSession.handleDataSendAckEvent(endOfStream);
        } else if (this.nextAudioSession && this.nextAudioSession.streamId === streamId) {
            this.nextAudioSession.handleDataSendAckEvent(endOfStream);
        } else {
            debug("Received dataSend acknowledgment event for unknown streamId '%s'", streamId);
        }
    }

    private handleDataSendCloseEvent(message: Record<any, any>): void { // controller indicates he can't handle audio request currently
        const streamId = message["streamId"];
        const reason = message["reason"] as DataSendCloseReason;

        if (this.activeAudioSession && this.activeAudioSession.streamId === streamId) {
            this.activeAudioSession.handleDataSendCloseEvent(reason);
        } else if (this.nextAudioSession && this.nextAudioSession.streamId === streamId) {
            this.nextAudioSession.handleDataSendCloseEvent(reason);
        } else {
            debug("Received dataSend close event for unknown streamId '%s'", streamId);
        }
    }

    private handleSiriAudioSessionClosed(session: SiriAudioSession): void {
        if (session === this.activeAudioSession) {
            this.activeAudioSession = this.nextAudioSession;
            this.nextAudioSession = undefined;
        } else if (session === this.nextAudioSession) {
            this.nextAudioSession = undefined;
        }
    }

    private handleDataStreamConnectionClosed(connection: DataStreamConnection): void {
        for (const [ targetIdentifier, connection0 ] of this.dataStreamConnections) {
            if (connection === connection0) {
                debug("HDS connection disconnected for targetIdentifier %s", targetIdentifier);
                this.dataStreamConnections.delete(targetIdentifier);
                break;
            }
        }
    }

    // ------------------------------- AUDIO CONFIGURATION -------------------------------

    private handleSelectedAudioConfigurationWrite(value: any, callback: CharacteristicSetCallback): void {
        const data = Buffer.from(value, 'base64');
        const objects = tlv.decode(data);

        const selectedAudioStreamConfiguration = tlv.decode(
            objects[SelectedAudioInputStreamConfigurationTypes.SELECTED_AUDIO_INPUT_STREAM_CONFIGURATION]
        );

        const codec = selectedAudioStreamConfiguration[AudioCodecConfigurationTypes.CODEC_TYPE][0];
        const parameters = tlv.decode(selectedAudioStreamConfiguration[AudioCodecConfigurationTypes.CODEC_PARAMETERS]);

        const channels = parameters[AudioCodecParametersTypes.CHANNEL][0];
        const bitrate = parameters[AudioCodecParametersTypes.BIT_RATE][0];
        const samplerate = parameters[AudioCodecParametersTypes.SAMPLE_RATE][0];

        this.selectedAudioConfiguration = {
            codecType: codec,
            parameters: {
                channels: channels,
                bitrate: bitrate,
                samplerate: samplerate,
                rtpTime: 20
            }
        };
        this.selectedAudioConfigurationString = RemoteController.buildSelectedAudioConfigurationTLV({
            audioCodecConfiguration: this.selectedAudioConfiguration,
        });

        callback();
    }

    private static buildSupportedAudioConfigurationTLV(configuration: SupportedAudioStreamConfiguration): string {
        const codecConfigurationTLV = RemoteController.buildCodecConfigurationTLV(configuration.audioCodecConfiguration);

        const supportedAudioStreamConfiguration = tlv.encode(
            SupportedAudioStreamConfigurationTypes.AUDIO_CODEC_CONFIGURATION, codecConfigurationTLV
        );
        return supportedAudioStreamConfiguration.toString('base64');
    }

    private static buildSelectedAudioConfigurationTLV(configuration: SelectedAudioStreamConfiguration): string {
        const codecConfigurationTLV = RemoteController.buildCodecConfigurationTLV(configuration.audioCodecConfiguration);

        const supportedAudioStreamConfiguration = tlv.encode(
            SelectedAudioInputStreamConfigurationTypes.SELECTED_AUDIO_INPUT_STREAM_CONFIGURATION, codecConfigurationTLV,
        );
        return supportedAudioStreamConfiguration.toString('base64');
    }

    private static buildCodecConfigurationTLV(codecConfiguration: AudioCodecConfiguration): Buffer {
        const parameters = codecConfiguration.parameters;

        let parametersTLV = tlv.encode(
            AudioCodecParametersTypes.CHANNEL, parameters.channels,
            AudioCodecParametersTypes.BIT_RATE, parameters.bitrate,
            AudioCodecParametersTypes.SAMPLE_RATE, parameters.samplerate,
        );
        if (parameters.rtpTime) {
            parametersTLV = Buffer.concat([
                parametersTLV,
                tlv.encode(AudioCodecParametersTypes.PACKET_TIME, parameters.rtpTime)
            ]);
        }

        return tlv.encode(
            AudioCodecConfigurationTypes.CODEC_TYPE, codecConfiguration.codecType,
            AudioCodecConfigurationTypes.CODEC_PARAMETERS, parametersTLV
        );
    }

    // -----------------------------------------------------------------------------------

    /**
     * @private
     */
    constructServices(): RemoteControllerServiceMap {
        this.targetControlManagementService = new Service.TargetControlManagement('', '');
        this.targetControlManagementService.setCharacteristic(Characteristic.TargetControlSupportedConfiguration, this.supportedConfiguration);
        this.targetControlManagementService.setCharacteristic(Characteristic.TargetControlList, this.targetConfigurationsString);
        this.targetControlManagementService.setPrimaryService();

        // you can also expose multiple TargetControl services to control multiple apple tvs simultaneously.
        // should we extend this class to support multiple TargetControl services or should users just create a second accessory?
        this.targetControlService = new Service.TargetControl('', '');
        this.targetControlService.setCharacteristic(Characteristic.ActiveIdentifier, 0);
        this.targetControlService.setCharacteristic(Characteristic.Active, false);
        this.targetControlService.setCharacteristic(Characteristic.ButtonEvent, this.lastButtonEvent);

        if (this.audioSupported) {
            this.siriService = new Service.Siri('', '');
            this.siriService.setCharacteristic(Characteristic.SiriInputType, Characteristic.SiriInputType.PUSH_BUTTON_TRIGGERED_APPLE_TV);

            this.audioStreamManagementService = new Service.AudioStreamManagement('', '');
            this.audioStreamManagementService.setCharacteristic(Characteristic.SupportedAudioStreamConfiguration, this.supportedAudioConfiguration);
            this.audioStreamManagementService.setCharacteristic(Characteristic.SelectedAudioStreamConfiguration, this.selectedAudioConfigurationString);

            this.dataStreamManagement = new DataStreamManagement();

            this.siriService.addLinkedService(this.dataStreamManagement!.getService());
            this.siriService.addLinkedService(this.audioStreamManagementService!);
        }

        return {
            targetControlManagement: this.targetControlManagementService,
            targetControl: this.targetControlService,

            siri: this.siriService,
            audioStreamManagement: this.audioStreamManagementService,
            dataStreamTransportManagement: this.dataStreamManagement?.getService()
        };
    }

    /**
     * @private
     */
    initWithServices(serviceMap: RemoteControllerServiceMap): void | RemoteControllerServiceMap {
        this.targetControlManagementService = serviceMap.targetControlManagement;
        this.targetControlService = serviceMap.targetControl;

        this.siriService = serviceMap.siri;
        this.audioStreamManagementService = serviceMap.audioStreamManagement;
        this.dataStreamManagement = new DataStreamManagement(serviceMap.dataStreamTransportManagement);
    }

    /**
     * @private
     */
    configureServices(): void {
        if (!this.targetControlManagementService || !this.targetControlService) {
            throw new Error("Unexpected state: Services not configured!"); // playing it save
        }

        this.targetControlManagementService.getCharacteristic(Characteristic.TargetControlList)!
            .on(CharacteristicEventTypes.GET, callback => {
                callback(null, this.targetConfigurationsString);
            })
            .on(CharacteristicEventTypes.SET, this.handleTargetControlWrite.bind(this));

        this.targetControlService.getCharacteristic(Characteristic.ActiveIdentifier)!
            .on(CharacteristicEventTypes.GET, callback => {
                callback(undefined, this.activeIdentifier);
            });
        this.targetControlService.getCharacteristic(Characteristic.Active)!
            .on(CharacteristicEventTypes.GET, callback => {
                callback(undefined, this.isActive());
            })
            .on(CharacteristicEventTypes.SET, (value, callback, context, connection) => {
                if (!connection) {
                    debug("Set event handler for Remote.Active cannot be called from plugin. Connection undefined!");
                    callback(HAPStatus.INVALID_VALUE_IN_REQUEST);
                    return;
                }
                this.handleActiveWrite(value, callback, connection);
            });
        this.targetControlService.getCharacteristic(Characteristic.ButtonEvent)!
            .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                callback(undefined, this.lastButtonEvent);
            });

        if (this.audioSupported) {
            this.audioStreamManagementService!.getCharacteristic(Characteristic.SelectedAudioStreamConfiguration)!
                .on(CharacteristicEventTypes.GET, callback => {
                    callback(null, this.selectedAudioConfigurationString);
                })
                .on(CharacteristicEventTypes.SET, this.handleSelectedAudioConfigurationWrite.bind(this))
                .updateValue(this.selectedAudioConfigurationString);

            this.dataStreamManagement!
                .onEventMessage(Protocols.TARGET_CONTROL, Topics.WHOAMI, this.handleTargetControlWhoAmI.bind(this))
                .onServerEvent(DataStreamServerEvent.CONNECTION_CLOSED, this.handleDataStreamConnectionClosed.bind(this));

            this.eventHandler = { // eventHandlers which gets subscribed to on open connections on whoami
                [Topics.ACK]: this.handleDataSendAckEvent.bind(this),
                [Topics.CLOSE]: this.handleDataSendCloseEvent.bind(this),
            };
        }
    }

    /**
     * @private
     */
    handleControllerRemoved(): void {
        this.targetControlManagementService = undefined;
        this.targetControlService = undefined;
        this.siriService = undefined;
        this.audioStreamManagementService = undefined;

        this.eventHandler = undefined;
        this.requestHandler = undefined;

        this.dataStreamManagement?.destroy();
        this.dataStreamManagement = undefined;

        // the call to dataStreamManagement.destroy will close any open data stream connection
        // which will result in a call to this.handleDataStreamConnectionClosed, cleaning up this.dataStreamConnections.
        // It will also result in a call to SiriAudioSession.handleDataStreamConnectionClosed (if there are any open session)
        // which again results in a call to this.handleSiriAudioSessionClosed,cleaning up this.activeAudioSession and this.nextAudioSession.
    }

    /**
     * @private
     */
    handleFactoryReset(): void {
        debug("Running factory reset. Resetting targets...");
        this.handleResetTargets(undefined);
        this.lastButtonEvent = "";
    }

    /**
     * @private
     */
    serialize(): SerializedControllerState | undefined {
        if (!this.activeIdentifier && Object.keys(this.targetConfigurations).length === 0) {
            return undefined;
        }

        return {
            activeIdentifier: this.activeIdentifier,
            targetConfigurations: [...this.targetConfigurations].reduce((obj: Record<number, TargetConfiguration>, [ key, value ]) => {
                obj[key] = value;
                return obj;
            }, {}),
        };
    }

    /**
     * @private
     */
    deserialize(serialized: SerializedControllerState): void {
        this.activeIdentifier = serialized.activeIdentifier;
        this.targetConfigurations = Object.entries(serialized.targetConfigurations).reduce((map: Map<number, TargetConfiguration>, [ key, value ]) => {
            const identifier = parseInt(key, 10);
            map.set(identifier, value);
            return map;
        }, new Map());
        this.updatedTargetConfiguration();
    }

    /**
     * @private
     */
    setupStateChangeDelegate(delegate?: StateChangeDelegate): void {
        this.stateChangeDelegate = delegate;
    }

}
// noinspection JSUnusedGlobalSymbols
/**
 * @deprecated - only there for backwards compatibility, please use {@see RemoteController} directly
 */
export class HomeKitRemoteController extends RemoteController {} // backwards compatibility

export const enum SiriAudioSessionEvents {
    CLOSE = "close",
}

export declare interface SiriAudioSession {
    on(event: "close", listener: () => void): this;

    emit(event: "close"): boolean;
}

/**
 * Represents an ongoing audio transmission
 */
export class SiriAudioSession extends EventEmitter {

    readonly connection: DataStreamConnection;
    private readonly selectedAudioConfiguration: AudioCodecConfiguration;

    private readonly producer: SiriAudioStreamProducer;
    private producerRunning = false; // indicates if the producer is running
    private producerTimer?: NodeJS.Timeout; // producer has a 3s timeout to produce the first frame, otherwise transmission will be cancelled

    state: SiriAudioSessionState = SiriAudioSessionState.STARTING;
    streamId?: number; // present when state >= SENDING
    endOfStream: boolean = false;

    private audioFrameQueue: AudioFrame[] = [];
    private readonly maxQueueSize = 1024;
    private sequenceNumber: number = 0;

    private readonly closeListener: () => void;

    constructor(connection: DataStreamConnection, selectedAudioConfiguration: AudioCodecConfiguration, producerConstructor: SiriAudioStreamProducerConstructor, producerOptions?: any) {
        super();
        this.connection = connection;
        this.selectedAudioConfiguration = selectedAudioConfiguration;

        this.producer = new producerConstructor(this.handleSiriAudioFrame.bind(this), this.handleProducerError.bind(this), producerOptions);

        this.connection.on(DataStreamConnectionEvent.CLOSED, this.closeListener = this.handleDataStreamConnectionClosed.bind(this));
    }

    /**
     * Called when siri button is pressed
     */
    start() {
        debug("Sending request to start siri audio stream");

        // opening dataSend
        this.connection.sendRequest(Protocols.DATA_SEND, Topics.OPEN, {
            target: "controller",
            type: "audio.siri"
        }, (error, status, message) => {
            if (this.state === SiriAudioSessionState.CLOSED) {
                debug("Ignoring dataSend open response as the session is already closed");
                return;
            }

            assert.strictEqual(this.state, SiriAudioSessionState.STARTING);
            this.state = SiriAudioSessionState.SENDING;

            if (error || status) {
                if (error) { // errors get produced by hap-nodejs
                    debug("Error occurred trying to start siri audio stream: %s", error.message);
                } else if (status) { // status codes are those returned by the hds response
                    debug("Controller responded with non-zero status code: %s", HDSStatus[status]);
                }
                this.closed();
            } else {
                this.streamId = message["streamId"];

                if (!this.producerRunning) { // audio producer errored in the meantime
                    this.sendDataSendCloseEvent(DataSendCloseReason.CANCELLED);
                } else {
                    debug("Successfully setup siri audio stream with streamId %d", this.streamId);
                }
            }
        });

        this.startAudioProducer(); // start audio producer and queue frames in the meantime
    }

    /**
     * @returns if the audio session is closing
     */
    isClosing() {
        return this.state >= SiriAudioSessionState.CLOSING;
    }

    /**
     * Called when siri button is released (or active identifier is changed to another device)
     */
    stop() {
        assert(this.state <= SiriAudioSessionState.SENDING, "state was higher than SENDING");

        debug("Stopping siri audio stream with streamId %d", this.streamId);

        this.endOfStream = true; // mark as endOfStream
        this.stopAudioProducer();

        if (this.state === SiriAudioSessionState.SENDING) {
            this.handleSiriAudioFrame(undefined); // send out last few audio frames with endOfStream property set

            this.state = SiriAudioSessionState.CLOSING; // we are waiting for an acknowledgment (triggered by endOfStream property)
        } else { // if state is not SENDING (aka state is STARTING) the callback for DATA_SEND OPEN did not yet return (or never will)
            this.closed();
        }
    }

    private startAudioProducer() {
        this.producer.startAudioProduction(this.selectedAudioConfiguration);
        this.producerRunning = true;

        this.producerTimer = setTimeout(() => { // producer has 3s to start producing audio frames
            debug("Didn't receive any frames from audio producer for stream with streamId %s. Canceling the stream now.", this.streamId);
            this.producerTimer = undefined;
            this.handleProducerError(DataSendCloseReason.CANCELLED);
        }, 3000);
        this.producerTimer.unref();
    }

    private stopAudioProducer() {
        this.producer.stopAudioProduction();
        this.producerRunning = false;

        if (this.producerTimer) {
            clearTimeout(this.producerTimer);
            this.producerTimer = undefined;
        }
    }

    private handleSiriAudioFrame(frame?: AudioFrame): void { // called from audio producer
        if (this.state >= SiriAudioSessionState.CLOSING) {
            return;
        }

        if (this.producerTimer) { // if producerTimer is defined, then this is the first frame we are receiving
            clearTimeout(this.producerTimer);
            this.producerTimer = undefined;
        }

        if (frame && this.audioFrameQueue.length < this.maxQueueSize) { // add frame to queue whilst it is not full
            this.audioFrameQueue.push(frame);
        }

        if (this.state !== SiriAudioSessionState.SENDING) { // dataSend isn't open yet
            return;
        }

        let queued;
        while ((queued = this.popSome()) !== null) { // send packets
            const packets: AudioFramePacket[] = [];
            queued.forEach(frame => {
                const packetData: AudioFramePacket = {
                    data: frame.data,
                    metadata: {
                        rms: new Float32(frame.rms),
                        sequenceNumber: new Int64(this.sequenceNumber++),
                    }
                };
                packets.push(packetData);
            });

            const message: DataSendMessageData = {
                packets: packets,
                streamId: new Int64(this.streamId!),
                endOfStream: this.endOfStream,
            };

            try {
                this.connection.sendEvent(Protocols.DATA_SEND, Topics.DATA, message);
            } catch (error) {
                debug("Error occurred when trying to send audio frame of hds connection: %s", error.message);

                this.stopAudioProducer();
                this.closed();
            }

            if (this.endOfStream) {
                break; // popSome() returns empty list if endOfStream=true
            }
        }
    }

    private handleProducerError(error: DataSendCloseReason): void { // called from audio producer
        if (this.state >= SiriAudioSessionState.CLOSING) {
            return;
        }

        this.stopAudioProducer(); // ensure backend is closed
        if (this.state === SiriAudioSessionState.SENDING) { // if state is less than sending dataSend isn't open (yet)
            this.sendDataSendCloseEvent(error); // cancel submission
        }
    }

    handleDataSendAckEvent(endOfStream: boolean): void { // transfer was successful
        assert.strictEqual(endOfStream, true);

        debug("Received acknowledgment for siri audio stream with streamId %s, closing it now", this.streamId);

        this.sendDataSendCloseEvent(DataSendCloseReason.NORMAL);
    }

    handleDataSendCloseEvent(reason: DataSendCloseReason): void { // controller indicates he can't handle audio request currently
        debug("Received close event from controller with reason %s for stream with streamId %s", DataSendCloseReason[reason], this.streamId);
        if (this.state <= SiriAudioSessionState.SENDING) {
            this.stopAudioProducer();
        }

        this.closed();
    }

    private sendDataSendCloseEvent(reason: DataSendCloseReason): void {
        assert(this.state >= SiriAudioSessionState.SENDING, "state was less than SENDING");
        assert(this.state <= SiriAudioSessionState.CLOSING, "state was higher than CLOSING");

        this.connection.sendEvent(Protocols.DATA_SEND, Topics.CLOSE, {
            streamId: new Int64(this.streamId!),
            reason: new Int64(reason),
        });

        this.closed();
    }

    private handleDataStreamConnectionClosed(): void {
        debug("Closing audio session with streamId %d", this.streamId);

        if (this.state <= SiriAudioSessionState.SENDING) {
            this.stopAudioProducer();
        }

        this.closed();
    }

    private closed(): void {
        const lastState = this.state;
        this.state = SiriAudioSessionState.CLOSED;

        if (lastState !== SiriAudioSessionState.CLOSED) {
            this.emit(SiriAudioSessionEvents.CLOSE);
            this.connection.removeListener(DataStreamConnectionEvent.CLOSED, this.closeListener);
        }
        this.removeAllListeners();
    }

    private popSome() { // tries to return 5 elements from the queue, if endOfStream=true also less than 5
        if (this.audioFrameQueue.length < 5 && !this.endOfStream) {
            return null;
        }

        const size = Math.min(this.audioFrameQueue.length, 5); // 5 frames per hap packet seems fine
        const result = [];
        for (let i = 0; i < size; i++) {
            const element = this.audioFrameQueue.shift()!; // removes first element
            result.push(element);
        }

        return result;
    }

}
