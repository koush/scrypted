// Based off of https://github.com/homebridge-eufy-security/plugin/blob/master/src/plugin/controller/LocalLivestreamManager.ts

import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, Camera, EufySecurity } from 'eufy-security-client';

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
  
  private readonly client: EufySecurity;
  private readonly device: Camera;
  
  constructor(client: EufySecurity, device: Camera, console: Console) {    
    super();

    this.console = console;
    this.client = client;
    this.device = device;

    this.stationStream = null;
    this.livestreamStartedAt = null;

    this.initialize();

    this.client.on('station livestream stop', (station: Station, device: Device) => {
      this.onStationLivestreamStop(station, device);
    });
    this.client.on('station livestream start',
      (station: Station, device: Device, metadata: StreamMetadata, videostream: Readable, audiostream: Readable) => {
        this.onStationLivestreamStart(station, device, metadata, videostream, audiostream);
      });
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
    this.console.debug(this.device.getName(), 'New instance requests livestream.');
    if (this.stationStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.console.debug(this.device.getName(), 'Using livestream that was started ' + runtime + ' seconds ago.');
      return this.stationStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }
  
  private async startAndGetLocalLiveStream(): Promise<StationStream> {
    return new Promise((resolve, reject) => {
      this.console.debug(this.device.getName(), 'Start new station livestream (P2P Session)...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.client.startStationLivestream(this.device.getSerial());
      } else {
        this.console.debug(this.device.getName(), 'stream is already starting. waiting...');
      }

      this.once('livestream start', async () => {
        if (this.stationStream !== null) {
          this.console.debug(this.device.getName(), 'New livestream started.');
          this.livestreamIsStarting = false;
          resolve(this.stationStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  public stopLocalLiveStream(): void {
    this.console.debug(this.device.getName(), 'Stopping station livestream.');
    this.client.stopStationLivestream(this.device.getSerial());
    this.initialize();
  }

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.console.info(station.getName() + ' station livestream for ' + device.getName() + ' has stopped.');
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
          this.console.warn(this.device.getName(), 'Second livestream was started from station. Ignore.');
          return;
        }
      }
      this.initialize(); // important to prevent unwanted behaviour when the eufy station emits the 'livestream start' event multiple times

      this.console.info(station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = {station, device, metadata, videostream, audiostream, createdAt};
      this.console.debug(this.device.getName(), 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));
      
      this.emit('livestream start');
    }
  }
}
