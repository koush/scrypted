import crypto from 'crypto';
import createDebug from "debug";
import { EventEmitter } from "events";
import { Readable } from 'stream';
import { CharacteristicValue, SessionIdentifier } from "../../types";
import {
  CameraStreamingOptions,
  LegacyCameraSourceAdapter,
  PrepareStreamRequest,
  PrepareStreamResponse,
  RTPStreamManagement,
  SnapshotRequest,
  StreamingRequest
} from "../camera";
import { CameraRecordingConfiguration, CameraRecordingOptions, RecordingManagement } from '../camera/RecordingManagement';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback
} from "../Characteristic";
import { DataStreamConnection, DataStreamManagement, DataStreamServerEvent, HDSStatus, Protocols, Topics } from '../datastream';
import { CameraOperatingMode, CameraRecordingManagement, DataStreamTransportManagement, Doorbell, Microphone, MotionSensor, Speaker } from "../definitions";
import { HAPStatus } from "../HAPServer";
import { Service } from "../Service";
import { Controller, ControllerIdentifier, ControllerServiceMap, DefaultControllerType } from "./Controller";


const debug = createDebug("HAP-NodeJS:Camera:Controller")

export interface CameraControllerOptions {
  /**
   * Amount of parallel camera streams the accessory is capable of running.
   * As of the official HAP specification non Secure Video cameras have a minimum required amount of 2 (but 1 is also fine).
   * Secure Video cameras just expose 1 stream.
   *
   * Default value: 1
   */
  cameraStreamCount?: number,

  /**
   * Delegate which handles the actual RTP/RTCP video/audio streaming and Snapshot requests.
   */
  delegate: CameraStreamingDelegate,

  /**
   * Options regarding video/audio streaming
   */
  streamingOptions: CameraStreamingOptions,
  /**
   * Options regarding Recordings (Secure Video)
   */
  recordingOptions?: CameraRecordingOptions,

  /**
   * Delegate which handles the audio/video recording data streaming on motion.
   */
  recordingDelegate?: CameraRecordingDelegate,
}

export type SnapshotRequestCallback = (error?: Error | HAPStatus, buffer?: Buffer) => void;
export type PrepareStreamCallback = (error?: Error, response?: PrepareStreamResponse) => void;
export type StreamRequestCallback = (error?: Error) => void;

export interface CameraStreamingDelegate {

  /**
   * This method is called when a HomeKit controller requests a snapshot image for the given camera.
   * The handler must respect the desired image height and width given in the {@link SnapshotRequest}.
   * The returned Buffer (via the callback) must be encoded in jpeg.
   *
   * HAP-NodeJS will complain about slow running handlers after 5 seconds and terminate the request after 15 seconds.
   *
   * @param request - Request containing image size.
   * @param callback - Callback supplied with the resulting Buffer
   */
  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void;

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void;
  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void;

}

export interface CameraRecordingDelegate {
  /**
   * HomeKit Secure Video expects a series of fragments that are
   * of duration specified by the fragmentLength.
   * 
   * @returns AsyncIterator of Readables representing each fragment.
   */
  handleFragmentsRequests(configuration: CameraRecordingConfiguration): AsyncGenerator<Buffer>;
}

/**
 * @private
 */
export interface CameraControllerServiceMap extends ControllerServiceMap {
  // "streamManagement%d": CameraRTPStreamManagement, // format to map all stream management services; indexed by zero

  microphone?: Microphone,
  speaker?: Speaker,

  cameraOperatingMode?: CameraOperatingMode,
  cameraEventRecordingManagement?: CameraRecordingManagement,
  dataStreamTransportManagement?: DataStreamTransportManagement,
  motionService?: MotionSensor,

  // this ServiceMap is also used by the DoorbellController; there is no necessity to declare it, but i think its good practice to reserve the namespace
  doorbell?: Doorbell;
}

export const enum CameraControllerEvents {
  /**
   *  Emitted when the mute state or the volume changed. The Apple Home App typically does not set those values
   *  except the mute state. When you adjust the volume in the Camera view it will reset the muted state if it was set previously.
   *  The value of volume has nothing to do with the volume slider in the Camera view of the Home app.
   */
  MICROPHONE_PROPERTIES_CHANGED = "microphone-change",
  /**
   * Emitted when the mute state or the volume changed. The Apple Home App typically does not set those values
   * except the mute state. When you unmute the device microphone it will reset the mute state if it was set previously.
   */
  SPEAKER_PROPERTIES_CHANGED = "speaker-change",
}

export declare interface CameraController {
  on(event: "microphone-change", listener: (muted: boolean, volume: number) => void): this;
  on(event: "speaker-change", listener: (muted: boolean, volume: number) => void): this;

  emit(event: "microphone-change", muted: boolean, volume: number): boolean;
  emit(event: "speaker-change", muted: boolean, volume: number): boolean;
}

/**
 * Everything needed to expose a HomeKit Camera.
 */
export class CameraController extends EventEmitter implements Controller<CameraControllerServiceMap> {

  private static readonly STREAM_MANAGEMENT = "streamManagement"; // key to index all RTPStreamManagement services

  private readonly streamCount: number;
  private readonly delegate: CameraStreamingDelegate;
  private readonly streamingOptions: CameraStreamingOptions;
  private readonly recordingOptions?: CameraRecordingOptions;
  private readonly recordingDelegate?: CameraRecordingDelegate;
  private readonly legacyMode: boolean = false;

  /**
   * @private
   */
  streamManagements: RTPStreamManagement[] = [];

  private microphoneService?: Microphone;
  private speakerService?: Speaker;

  private microphoneMuted: boolean = false;
  private microphoneVolume: number = 100;
  private speakerMuted: boolean = false;
  private speakerVolume: number = 100;

  private cameraOperatingModeService?: CameraOperatingMode;
  private recordingManagement?: RecordingManagement;
  private dataStreamManagement?: DataStreamManagement;
  motionService?: MotionSensor;
  private connectionMap = new Map<number, {
    generator: AsyncGenerator<Buffer>,
    connection: DataStreamConnection,
  }>();

  private homekitCameraActive = false;
  private eventSnapshotsActive = false;
  private periodicSnapshotsActive = false;

  constructor(options: CameraControllerOptions, legacyMode: boolean = false) {
    super();
    this.streamCount = Math.max(1, options.cameraStreamCount || 1);
    this.delegate = options.delegate;
    this.streamingOptions = options.streamingOptions;
    this.recordingOptions = options.recordingOptions;
    this.recordingDelegate = options.recordingDelegate;

    this.legacyMode = legacyMode; // legacy mode will prent from Microphone and Speaker services to get created to avoid collisions
  }

  /**
   * @private
   */
  controllerId(): ControllerIdentifier {
    return DefaultControllerType.CAMERA;
  }

  // ----------------------------------- STREAM API ------------------------------------

  /**
   * Call this method if you want to forcefully suspend an ongoing streaming session.
   * This would be adequate if the the rtp server or media encoding encountered an unexpected error.
   *
   * @param sessionId {SessionIdentifier} - id of the current ongoing streaming session
   */
  public forceStopStreamingSession(sessionId: SessionIdentifier) {
    this.streamManagements.forEach(management => {
      if (management.sessionIdentifier === sessionId) {
        management.forceStop();
      }
    });
  }

  public static generateSynchronisationSource() {
    const ssrc = crypto.randomBytes(4); // range [-2.14748e+09 - 2.14748e+09]
    ssrc[0] = 0;
    return ssrc.readInt32BE(0);
  }

  // ----------------------------- MICROPHONE/SPEAKER API ------------------------------

  public setMicrophoneMuted(muted: boolean = true) {
    if (!this.microphoneService) {
      return;
    }

    this.microphoneMuted = muted;
    this.microphoneService.updateCharacteristic(Characteristic.Mute, muted);
  }

  public setMicrophoneVolume(volume: number) {
    if (!this.microphoneService) {
      return;
    }

    this.microphoneVolume = volume;
    this.microphoneService.updateCharacteristic(Characteristic.Volume, volume);
  }

  public setSpeakerMuted(muted: boolean = true) {
    if (!this.speakerService) {
      return;
    }

    this.speakerMuted = muted;
    this.speakerService.updateCharacteristic(Characteristic.Mute, muted);
  }

  public setSpeakerVolume(volume: number) {
    if (!this.speakerService) {
      return;
    }

    this.speakerVolume = volume;
    this.speakerService.updateCharacteristic(Characteristic.Volume, volume);
  }

  private emitMicrophoneChange() {
    this.emit(CameraControllerEvents.MICROPHONE_PROPERTIES_CHANGED, this.microphoneMuted, this.microphoneVolume);
  }

  private emitSpeakerChange() {
    this.emit(CameraControllerEvents.SPEAKER_PROPERTIES_CHANGED, this.speakerMuted, this.speakerVolume);
  }

  // -----------------------------------------------------------------------------------

  /**
   * @private
   */
  constructServices(): CameraControllerServiceMap {
    for (let i = 0; i < this.streamCount; i++) {
      const rtp = new RTPStreamManagement(i, this.streamingOptions, this.delegate);
      this.streamManagements.push(rtp);

      // koush
      if (this.recordingOptions) {
        rtp.getService().getCharacteristic(Characteristic.Active)
          .on('get', callback => {
            callback(null, Characteristic.Active.ACTIVE)
          })
          .on('set', (value, callback) => {
            callback();
          });
      }
    }

    if (!this.legacyMode && this.streamingOptions.audio) {
      // In theory the Microphone Service is a necessity. In practice its not. lol. So we just add it if the user wants to support audio
      this.microphoneService = new Service.Microphone('', '');
      this.microphoneService.setCharacteristic(Characteristic.Volume, this.microphoneVolume);

      if (this.streamingOptions.audio.twoWayAudio) {
        this.speakerService = new Service.Speaker('', '');
        this.speakerService.setCharacteristic(Characteristic.Volume, this.speakerVolume);
      }
    }

    if (this.recordingOptions) {
      this.cameraOperatingModeService = new Service.CameraOperatingMode('', '');
      this.recordingManagement = new RecordingManagement(this.recordingOptions, this.recordingDelegate!);
      this.dataStreamManagement = new DataStreamManagement();

      if (this.recordingOptions.motionService) {
        this.motionService = new MotionSensor('', '');
        this.motionService.getCharacteristic(Characteristic.Active)
          .on('get', callback => {
            callback(null, Characteristic.Active.ACTIVE)
          })
          .on('set', (value, callback) => {
            callback();
          });

        this.recordingManagement.getService().addLinkedService(this.motionService);
      }

      this.recordingManagement.getService().addLinkedService(this.dataStreamManagement.getService());
    }

    const serviceMap: CameraControllerServiceMap = {
      microphone: this.microphoneService,
      speaker: this.speakerService,
      cameraOperatingMode: this.cameraOperatingModeService,
      cameraEventRecordingManagement: this.recordingManagement?.getService(),
      dataStreamTransportManagement: this.dataStreamManagement?.getService(),
      motionService: this.motionService,
    };

    this.streamManagements.forEach((management, index) => serviceMap[CameraController.STREAM_MANAGEMENT + index] = management.getService());

    return serviceMap;
  }

  /**
   * @private
   */
  initWithServices(serviceMap: CameraControllerServiceMap): void | CameraControllerServiceMap {
    let modifiedServiceMap = false;

    for (let i = 0; true; i++) {
      let streamManagementService = serviceMap[CameraController.STREAM_MANAGEMENT + i];

      if (i < this.streamCount) {
        if (streamManagementService) { // normal init
          this.streamManagements.push(new RTPStreamManagement(i, this.streamingOptions, this.delegate, streamManagementService));
        } else { // stream count got bigger, we need to create a new service
          const management = new RTPStreamManagement(i, this.streamingOptions, this.delegate);

          this.streamManagements.push(management);
          serviceMap[CameraController.STREAM_MANAGEMENT + i] = management.getService();

          modifiedServiceMap = true;
        }
      } else {
        if (streamManagementService) { // stream count got reduced, we need to remove old service
          delete serviceMap[CameraController.STREAM_MANAGEMENT + i];
          modifiedServiceMap = true;
        } else {
          break; // we finished counting and we got no saved service; we are finished
        }
      }
    }

    // MICROPHONE
    if (!this.legacyMode && this.streamingOptions.audio) { // microphone should be present
      if (serviceMap.microphone) {
        this.microphoneService = serviceMap.microphone;
      } else {
        // microphone wasn't created yet => create a new one
        this.microphoneService = new Service.Microphone('', '');
        this.microphoneService.setCharacteristic(Characteristic.Volume, this.microphoneVolume);

        serviceMap.microphone = this.microphoneService;
        modifiedServiceMap = true;
      }
    } else if (serviceMap.microphone) { // microphone service supplied, though settings seemed to have changed
      // we need to remove it
      delete serviceMap.microphone;
      modifiedServiceMap = true;
    }

    // SPEAKER
    if (!this.legacyMode && this.streamingOptions.audio?.twoWayAudio) { // speaker should be present
      if (serviceMap.speaker) {
        this.speakerService = serviceMap.speaker;
      } else {
        // speaker wasn't created yet => create a new one
        this.speakerService = new Service.Speaker('', '');
        this.speakerService.setCharacteristic(Characteristic.Volume, this.speakerVolume);

        serviceMap.speaker = this.speakerService;
        modifiedServiceMap = true;
      }
    } else if (serviceMap.speaker) { // speaker service supplied, though settings seemed to have changed
      // we need to remove it
      delete serviceMap.speaker;
      modifiedServiceMap = true;
    }

    if (this.recordingOptions) {
      if (serviceMap.cameraOperatingMode) {
        this.cameraOperatingModeService = serviceMap.cameraOperatingMode;
      }
      else {
        this.cameraOperatingModeService = new Service.CameraOperatingMode('', '');
        serviceMap.cameraOperatingMode = this.cameraOperatingModeService;
        modifiedServiceMap = true;
      }
      if (serviceMap.cameraEventRecordingManagement) {
        this.recordingManagement = new RecordingManagement(this.recordingOptions, this.recordingDelegate!, serviceMap.cameraEventRecordingManagement);
      }
      else {
        this.recordingManagement = new RecordingManagement(this.recordingOptions, this.recordingDelegate!);
        serviceMap.cameraEventRecordingManagement = this.recordingManagement.getService();
        modifiedServiceMap = true;
      }
      if (serviceMap.dataStreamTransportManagement) {
        this.dataStreamManagement = new DataStreamManagement(serviceMap.dataStreamTransportManagement);
      }
      else {
        this.dataStreamManagement = new DataStreamManagement();
        serviceMap.dataStreamTransportManagement = this.dataStreamManagement.getService();
        modifiedServiceMap = true;
      }
      if (serviceMap.motionService) {
        this.motionService = serviceMap.motionService;
      }
      else {
        this.motionService = new MotionSensor('', '');
        serviceMap.motionService = this.motionService;
        modifiedServiceMap = true;
      }
    }
    else {
      if (serviceMap.cameraOperatingMode) {
        delete serviceMap.cameraOperatingMode;
        modifiedServiceMap = true;
      }
      if (serviceMap.cameraEventRecordingManagement) {
        delete serviceMap.cameraEventRecordingManagement;
        modifiedServiceMap = true;
      }
      if (serviceMap.dataStreamTransportManagement) {
        delete serviceMap.dataStreamTransportManagement;
        modifiedServiceMap = true;
      }
      if (serviceMap.motionService) {
        delete serviceMap.motionService;
        modifiedServiceMap = true;
      }
    }

    if (this.migrateFromDoorbell(serviceMap)) {
      modifiedServiceMap = true;
    }

    if (modifiedServiceMap) { // serviceMap must only be returned if anything actually changed
      return serviceMap;
    }
  }

  // overwritten in DoorbellController (to avoid cyclic dependencies, i hate typescript for that)
  protected migrateFromDoorbell(serviceMap: ControllerServiceMap): boolean {
    if (serviceMap.doorbell) { // See NOTICE in DoorbellController
      delete serviceMap.doorbell;
      return true;
    }

    return false;
  }

  /**
   * @private
   */
  configureServices(): void {
    if (this.microphoneService) {
      this.microphoneService.getCharacteristic(Characteristic.Mute)!
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          callback(undefined, this.microphoneMuted);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.microphoneMuted = value as boolean;
          callback();
          this.emitMicrophoneChange();
        });
      this.microphoneService.getCharacteristic(Characteristic.Volume)!
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          callback(undefined, this.microphoneVolume);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.microphoneVolume = value as number;
          callback();
          this.emitMicrophoneChange();
        });
    }

    if (this.speakerService) {
      this.speakerService.getCharacteristic(Characteristic.Mute)!
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          callback(undefined, this.speakerMuted);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.speakerMuted = value as boolean;
          callback();
          this.emitSpeakerChange();
        });
      this.speakerService.getCharacteristic(Characteristic.Volume)!
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          callback(undefined, this.speakerVolume);
        })
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.speakerVolume = value as number;
          callback();
          this.emitSpeakerChange();
        });
    }

    // koush
    if (this.cameraOperatingModeService) {
      this.cameraOperatingModeService.getCharacteristic(Characteristic.EventSnapshotsActive)
        .on('get', callback => {
          callback(null, this.eventSnapshotsActive)
        })
        .on('set', (value, callback) => {
          this.eventSnapshotsActive = !!value;
          callback();
        });

      this.cameraOperatingModeService.getCharacteristic(Characteristic.HomeKitCameraActive)
        .on('get', callback => {
          callback(null, this.homekitCameraActive)
        })
        .on('set', (value, callback) => {
          this.homekitCameraActive = !!value;
          callback();
        });

      this.cameraOperatingModeService.getCharacteristic(Characteristic.PeriodicSnapshotsActive)
        .on('get', callback => {
          callback(null, this.periodicSnapshotsActive)
        })
        .on('set', (value, callback) => {
          this.periodicSnapshotsActive = !!value;
          callback();
        });
    }

    if (this.dataStreamManagement) {
      this.dataStreamManagement!
        .onRequestMessage(Protocols.DATA_SEND, Topics.OPEN, this.handleDataSendOpen.bind(this))
        .onEventMessage(Protocols.DATA_SEND, Topics.CLOSE, this.handleDataSendClose.bind(this))
        .onServerEvent(DataStreamServerEvent.CONNECTION_CLOSED, this.handleDataStreamConnectionClosed.bind(this));
    }
  }

  private async handleDataSendOpen(connection: DataStreamConnection, id: number, message: Record<any, any>) {
    const streamId: number = message.streamId;
    const generator = this.recordingDelegate!.handleFragmentsRequests(this.recordingManagement!.getSelectedConfiguration());

    this.connectionMap.set(streamId, { generator, connection });

    let first = true;
    const maxChunk = 0x40000;
    try {
      let dataSequenceNumber = 1;
      for await (const fragment of generator) {
        const wasFirst = first;
        if (first) {
          first = false;
          connection.sendResponse(Protocols.DATA_SEND, Topics.OPEN, id, HDSStatus.SUCCESS, {
            status: HDSStatus.SUCCESS,
          });
        }

        let offset = 0;
        let dataChunkSequenceNumber = 1;
        while (offset < fragment.length) {
          const data = fragment.slice(offset, offset + maxChunk);
          offset += data.length;
          const isLastDataChunk = offset >= fragment.length;
          const event = {
            streamId,
            packets: [
              {
                metadata: {
                  dataType: wasFirst ? 'mediaInitialization' : 'mediaFragment',
                  dataSequenceNumber,
                  isLastDataChunk,
                  dataChunkSequenceNumber,
                },
                data,
              }
            ]
          };
          connection.sendEvent(Protocols.DATA_SEND, Topics.DATA, event);
          dataChunkSequenceNumber++;
        }

        dataSequenceNumber++;
      }
    }
    catch (e) {
    }
    finally {
      if (first) {
        connection.sendResponse(Protocols.DATA_SEND, Topics.OPEN, id, HDSStatus.PROTOCOL_SPECIFIC_ERROR, {
          status: HDSStatus.PROTOCOL_SPECIFIC_ERROR,
        });
      }
    }
  }

  private async handleDataSendClose(connection: DataStreamConnection, message: Record<any, any>) {
    const streamId: number = message.streamId;
    const entry = this.connectionMap.get(streamId);
    if (!entry)
      return;
    this.connectionMap.delete(streamId);
    const { generator } = entry;
    generator.throw('dataSend close');
  }

  private handleDataStreamConnectionClosed(closedConnection: DataStreamConnection) {
    for (const [key, { generator, connection }] of this.connectionMap.entries()) {
      if (connection === closedConnection) {
        this.connectionMap.delete(key);
        generator.throw('connection closed');
      }
    }
  }

  /**
   * @private
   */
  handleControllerRemoved(): void {
    this.handleFactoryReset();

    for (const management of this.streamManagements) {
      management.destroy();
    }
    this.streamManagements.splice(0, this.streamManagements.length);

    this.microphoneService = undefined;
    this.speakerService = undefined;

    this.removeAllListeners();
  }

  /**
   * @private
   */
  handleFactoryReset(): void {
    this.streamManagements.forEach(management => management.handleFactoryReset());

    this.microphoneMuted = false;
    this.microphoneVolume = 100;
    this.speakerMuted = false;
    this.speakerVolume = 100;
  }

  /**
   * @private
   */
  handleSnapshotRequest(height: number, width: number, accessoryName?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | undefined = setTimeout(() => {
        console.warn(`[${accessoryName}] The image snapshot handler for the given accessory is slow to respond! See https://git.io/JtMGR for more info.`);

        timeout = setTimeout(() => {
          timeout = undefined;

          console.warn(`[${accessoryName}] The image snapshot handler for the given accessory didn't respond at all! See https://git.io/JtMGR for more info.`);

          reject(HAPStatus.OPERATION_TIMED_OUT);
        }, 17000);
        timeout.unref();
      }, 5000);
      timeout.unref();

      try {
        this.delegate.handleSnapshotRequest({
          height: height,
          width: width,
        }, (error, buffer) => {
          if (!timeout) {
            return;
          } else {
            clearTimeout(timeout);
            timeout = undefined;
          }

          if (error) {
            if (typeof error === "number") {
              reject(error);
            } else {
              debug("[%s] Error getting snapshot: %s", accessoryName, error.stack);
              reject(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
            }
            return;
          }

          if (!buffer || buffer.length === 0) {
            console.warn(`[${accessoryName}] Snapshot request handler provided empty image buffer!`);
            reject(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          } else {
            resolve(buffer);
          }
        });
      } catch (error) {
        if (!timeout) {
          return;
        } else {
          clearTimeout(timeout);
          timeout = undefined;
        }

        console.warn(`[${accessoryName}] Unhandled error thrown inside snapshot request handler: ${error.stack}`);
        reject(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });
  }

  /**
   * @private
   */
  handleCloseConnection(sessionID: SessionIdentifier): void {
    if (this.delegate instanceof LegacyCameraSourceAdapter) {
      this.delegate.forwardCloseConnection(sessionID);
    }
  }

}
