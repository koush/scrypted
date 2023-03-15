// Based off of https://github.com/homebridge-eufy-security/plugin/blob/master/src/plugin/controller/LocalLivestreamManager.ts

import { Camera, CommandData, CommandName, CommandType, Device, DeviceType, EufySecurity, isGreaterEqualMinVersion, P2PClientProtocol, ParamType, Station, StreamMetadata, VideoCodec } from 'eufy-security-client';
import { EventEmitter, Readable } from 'stream';

type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

export class LocalLivestreamManager extends EventEmitter {
  private stationStream: StationStream | null;
  private console: Console;

  private livestreamStartedAt: number | null;
  private livestreamIsStarting = false;
  
  private readonly id: string;
  private readonly client: EufySecurity;
  private readonly device: Camera;
  
  private station: Station;
  private p2pSession: P2PClientProtocol;
  
  constructor(id: string, client: EufySecurity, device: Camera, console: Console) {    
    super();

    this.id = id;
    this.console = console;
    this.client = client;
    this.device = device;
    
    this.client.getStation(this.device.getStationSerial()).then( (station) => {
      this.station = station;
      this.p2pSession = new P2PClientProtocol(station.getRawStation(), this.client.getApi(), station.getIPAddress());
      this.p2pSession.on("livestream started", (channel: number, metadata: StreamMetadata, videostream: Readable, audiostream: Readable) => {
        this.onStationLivestreamStart(station, device, metadata, videostream, audiostream);
      });
      this.p2pSession.on("livestream stopped", (channel: number) => {
        this.onStationLivestreamStop(station, device);
      });
      this.p2pSession.on("livestream error", (channel: number, error: Error) => {
        this.stopLivestream();
      });
    });

    this.stationStream = null;
    this.livestreamStartedAt = null;

    this.initialize();
  }

  private initialize() {
    if (this.stationStream) {
      this.stationStream.audiostream.unpipe();
      this.stationStream.audiostream.destroy();
      this.stationStream.videostream.unpipe();
      this.stationStream.videostream.destroy();
    }
    this.stationStream = null;
    this.livestreamStartedAt = null;
  }

  public async getLocalLivestream(): Promise<StationStream> {
    this.console.debug(this.device.getName(), this.id, 'New instance requests livestream.');
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.console.debug(this.device.getName(), this.id, 'Using livestream that was started ' + runtime + ' seconds ago.');
      return this.stationStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }
  
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.console.debug(this.device.getName(), this.id, 'Start new station livestream...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.startStationLivestream();
      } else {
        this.console.debug(this.device.getName(), this.id, 'stream is already starting. waiting...');
      }

      this.once('livestream start', async () => {
        if (this.stationStream !== null) {
          this.console.debug(this.device.getName(), this.id, 'New livestream started.');
          this.livestreamIsStarting = false;
          resolve(this.stationStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  private async startStationLivestream(videoCodec: VideoCodec = VideoCodec.H264): Promise<void> {
    const commandData: CommandData = {
        name: CommandName.DeviceStartLivestream,
        value: videoCodec
    };
    this.console.debug(this.device.getName(), this.id, `Sending start livestream command to station ${this.station.getSerial()}`);
    const rsa_key = this.p2pSession.getRSAPrivateKey();

    if (this.device.isSoloCameras() || this.device.getDeviceType() === DeviceType.FLOODLIGHT_CAMERA_8423 || this.device.isWiredDoorbellT8200X()) {
        this.console.debug(this.device.getName(), this.id, `Using CMD_DOORBELL_SET_PAYLOAD (1) for station ${this.station.getSerial()} (main_sw_version: ${this.station.getSoftwareVersion()})`);
        await this.p2pSession.sendCommandWithStringPayload({
            commandType: CommandType.CMD_DOORBELL_SET_PAYLOAD,
            value: JSON.stringify({
                "commandType": ParamType.COMMAND_START_LIVESTREAM,
                "data": {
                    "accountId": this.station.getRawStation().member.admin_user_id,
                    "encryptkey": rsa_key?.exportKey("components-public").n.slice(1).toString("hex"),
                    "streamtype": videoCodec
                }
            }),
            channel: this.device.getChannel()
        }, {
            command: commandData
        });
    } else if (this.device.isWiredDoorbell() || (this.device.isFloodLight() && this.device.getDeviceType() !== DeviceType.FLOODLIGHT) || this.device.isIndoorCamera() || (this.device.getSerial().startsWith("T8420") && isGreaterEqualMinVersion("2.0.4.8", this.station.getSoftwareVersion()))) {
        this.console.debug(this.device.getName(), this.id, `Using CMD_DOORBELL_SET_PAYLOAD (2) for station ${this.station.getSerial()} (main_sw_version: ${this.station.getSoftwareVersion()})`);
        await this.p2pSession.sendCommandWithStringPayload({
            commandType: CommandType.CMD_DOORBELL_SET_PAYLOAD,
            value: JSON.stringify({
                "commandType": ParamType.COMMAND_START_LIVESTREAM,
                "data": {
                    "account_id": this.station.getRawStation().member.admin_user_id,
                    "encryptkey": rsa_key?.exportKey("components-public").n.slice(1).toString("hex"),
                    "streamtype": videoCodec
                }
            }),
            channel: this.device.getChannel()
        }, {
            command: commandData
        });
    } else {
        if ((Device.isIntegratedDeviceBySn(this.station.getSerial()) || !isGreaterEqualMinVersion("2.0.9.7", this.station.getSoftwareVersion())) && (!this.station.getSerial().startsWith("T8420") || !isGreaterEqualMinVersion("1.0.0.25", this.station.getSoftwareVersion()))) {
            this.console.debug(this.device.getName(), this.id, `Using CMD_START_REALTIME_MEDIA for station ${this.station.getSerial()} (main_sw_version: ${this.station.getSoftwareVersion()})`);
            await this.p2pSession.sendCommandWithInt({
                commandType: CommandType.CMD_START_REALTIME_MEDIA,
                value: this.device.getChannel(),
                strValue: rsa_key?.exportKey("components-public").n.slice(1).toString("hex"),
                channel: this.device.getChannel()
            }, {
                command: commandData
            });
        } else {
            this.console.debug(this.device.getName(), this.id, `Using CMD_SET_PAYLOAD for station ${this.station.getSerial()} (main_sw_version: ${this.station.getSoftwareVersion()})`);
            await this.p2pSession.sendCommandWithStringPayload({
                commandType: CommandType.CMD_SET_PAYLOAD,
                value: JSON.stringify({
                    "account_id": this.station.getRawStation().member.admin_user_id,
                    "cmd": CommandType.CMD_START_REALTIME_MEDIA,
                    "mValue3": CommandType.CMD_START_REALTIME_MEDIA,
                    "payload": {
                        "ClientOS": "Android",
                        "key": rsa_key?.exportKey("components-public").n.slice(1).toString("hex"),
                        "streamtype": videoCodec === VideoCodec.H264 ? 1 : 2,
                    }
                }),
                channel: this.device.getChannel()
            }, {
                command: commandData
            });
        }
    }
  }

  public stopLocalLiveStream(): void {
    this.console.debug(this.device.getName(), this.id, 'Stopping station livestream.');
    this.stopLivestream();
    this.initialize();
  }

  private async stopLivestream(): Promise<void> {
    const commandData: CommandData = {
        name: CommandName.DeviceStopLivestream
    };
    this.console.debug(this.device.getName(), this.id, `Sending stop livestream command to station ${this.station.getSerial()}`);
    await this.p2pSession.sendCommandWithInt({
        commandType: CommandType.CMD_STOP_REALTIME_MEDIA,
        value: this.device.getChannel(),
        channel: this.device.getChannel()
    }, {
        command: commandData
    });
}

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.console.info(this.id + ' - ' + station.getName() + ' station livestream for ' + device.getName() + ' has stopped.');
      this.initialize();
    }
  }

  private async onStationLivestreamStart(
    station: Station,
    device: Device,
    metadata: StreamMetadata,
    videostream: Readable,
    audiostream: Readable,
  ) {
    if (device.getSerial() === this.device.getSerial()) {
      if (this.stationStream) {
        const diff = (Date.now() - this.stationStream.createdAt) / 1000;
        if (diff < 5) {
          this.console.warn(this.device.getName(), this.id,  'Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behaviour when the eufy station emits the 'livestream start' event multiple times

      this.console.info(this.id + ' - ' + station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = {station, device, metadata, videostream, audiostream, createdAt};
      this.console.debug(this.device.getName(), this.id, 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));
      
      this.emit('livestream start');
    }
  }
}
