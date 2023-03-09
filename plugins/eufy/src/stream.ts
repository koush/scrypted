// Based off of https://github.com/homebridge-eufy-security/plugin/blob/master/src/plugin/controller/LocalLivestreamManager.ts

import { EventEmitter, Readable } from 'stream';
import { Station, Device, StreamMetadata, Camera, EufySecurity } from 'eufy-security-client';
import path from 'path';

type StationStream = {
  station: Station;
  device: Device;
  metadata: StreamMetadata;
  videostream: Readable;
  audiostream: Readable;
  createdAt: number;
};

class AudiostreamProxy extends Readable {

  private console: Console;

  private cacheData: Array<Buffer> = [];
  private pushNewDataImmediately = false;

  private dataFramesCount = 0;

  constructor(console: Console) {
    super();
    this.console = console;
  }

  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  public newAudioData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      this.transmitData(data);
    } else {
      this.cacheData.push(data);
    }
  }

  public stopProxyStream(): void {
    this.console.debug('Audiostream was stopped after transmission of ' + this.dataFramesCount + ' data chunks.');
    this.unpipe();
    this.destroy();
  }

  _read(size: number): void {
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }
}

class VideostreamProxy extends Readable {

  private manager: LocalLivestreamManager;
  private livestreamId: number;

  private cacheData: Array<Buffer> = [];
  private console: Console;

  private killTimeout: NodeJS.Timeout | null = null;

  private pushNewDataImmediately = false;
  private dataFramesCount = 0;

  constructor(id: number, cacheData: Array<Buffer>, manager: LocalLivestreamManager, console: Console) {
    super();

    this.livestreamId = id;
    this.manager = manager;
    this.cacheData = cacheData;
    this.console = console;
    this.resetKillTimeout();
  }

  private transmitData(data: Buffer | undefined): boolean {
    this.dataFramesCount++;
    return this.push(data);
  }

  public newVideoData(data: Buffer): void {
    if (this.pushNewDataImmediately) {
      this.pushNewDataImmediately = false;
      try {
        if(this.transmitData(data)) {
          this.resetKillTimeout();
        }
      } catch (err) {
        this.console.debug('Push of new data was not succesful. Most likely the target process (ffmpeg) was already terminated. Error: ' + err);
      }
    } else {
      this.cacheData.push(data);
    }
  }

  public stopProxyStream(): void {
    this.console.debug('Videostream was stopped after transmission of ' + this.dataFramesCount + ' data chunks.');
    this.unpipe();
    this.destroy();
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
  }

  private resetKillTimeout(): void {
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
    }
    this.killTimeout = setTimeout(() => {
      this.console.warn('Proxy Stream (id: ' + this.livestreamId + ') was terminated due to inactivity. (no data transmitted in 15 seconds)');
      this.manager.stopProxyStream(this.livestreamId);
    }, 15000);
  }

  _read(size: number): void {
    this.resetKillTimeout();
    let pushReturn = true;
    while (this.cacheData.length > 0 && pushReturn) {
      const data = this.cacheData.shift();
      pushReturn = this.transmitData(data);
    }
    if (pushReturn) {
      this.pushNewDataImmediately = true;
    }
  }

}

type ProxyStream = {
  id: number;
  videostream: VideostreamProxy;
  audiostream: AudiostreamProxy;
};

export class LocalLivestreamManager extends EventEmitter {
  
  private readonly SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED = 45;
  private readonly CONNECTION_ESTABLISHED_TIMEOUT = 5;

  private stationStream: StationStream | null;
  private console: Console;

  private livestreamCount = 1;
  private iFrameCache: Array<Buffer> = [];

  private proxyStreams: Set<ProxyStream> = new Set<ProxyStream>();

  private cacheEnabled: boolean;

  private connectionTimeout?: NodeJS.Timeout;
  private terminationTimeout?: NodeJS.Timeout;

  private livestreamStartedAt: number | null;
  private livestreamIsStarting = false;
  
  private readonly client: EufySecurity;
  private readonly device: Camera;
  
  constructor(client: EufySecurity, device: Camera, cacheEnabled: boolean, console: Console) {    
    super();

    this.console = console;
    this.client = client;
    this.device = device;

    this.cacheEnabled = cacheEnabled;
    if (this.cacheEnabled) {
      this.console.debug('Livestream caching for ' + this.device.getName() + ' is enabled.');
    }

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
    this.iFrameCache = [];
    this.livestreamStartedAt = null;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
  }

  public async getLocalLivestream(): Promise<ProxyStream> {
    this.console.debug(this.device.getName(), 'New instance requests livestream. There were ' +
                    this.proxyStreams.size + ' instance(s) using the livestream until now.');
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    const proxyStream = await this.getProxyStream();
    if (proxyStream) {
      const runtime = (Date.now() - this.livestreamStartedAt!) / 1000;
      this.console.debug(
        this.device.getName(),
        'Using livestream that was started ' + runtime + ' seconds ago. The proxy stream has id: ' + proxyStream.id + '.');
      return proxyStream;
    } else {
      return await this.startAndGetLocalLiveStream();
    }
  }
  
  private async startAndGetLocalLiveStream(): Promise<ProxyStream> {
    return new Promise((resolve, reject) => {
      this.console.debug(this.device.getName(), 'Start new station livestream (P2P Session)...');
      if (!this.livestreamIsStarting) { // prevent multiple stream starts from eufy station
        this.livestreamIsStarting = true;
        this.client.startStationLivestream(this.device.getSerial());
      } else {
        this.console.debug(this.device.getName(), 'stream is already starting. waiting...');
      }

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
      }
      this.connectionTimeout = setTimeout(() => {
        this.livestreamIsStarting = false;
        this.console.error(this.device.getName(), 'Local livestream didn\'t start in time. Abort livestream request.');
        reject('no started livestream found');
      }, this.CONNECTION_ESTABLISHED_TIMEOUT * 2000);

      this.once('livestream start', async () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        const proxyStream = await this.getProxyStream();
        if (proxyStream !== null) {
          this.console.debug(this.device.getName(), 'New livestream started. Proxy stream has id: ' + proxyStream.id + '.');
          this.livestreamIsStarting = false;
          resolve(proxyStream);
        } else {
          reject('no started livestream found');
        }
      });
    });
  }

  private scheduleLivestreamCacheTermination(streamingTimeLeft: number): void {
    // eslint-disable-next-line max-len
    const terminationTime = ((streamingTimeLeft - this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED) > 20) ? this.SECONDS_UNTIL_TERMINATION_AFTER_LAST_USED : streamingTimeLeft - 20;
    this.console.debug(
      this.device.getName(),
      'Schedule livestream termination in ' + terminationTime + ' seconds.');
    if (this.terminationTimeout) {
      clearTimeout(this.terminationTimeout);
    }
    this.terminationTimeout = setTimeout(() => {
      if (this.proxyStreams.size <= 0) {
        this.stopLocalLiveStream();
      }
    }, terminationTime * 1000);
  }

  public stopLocalLiveStream(): void {
    this.console.debug(this.device.getName(), 'Stopping station livestream.');
    this.client.stopStationLivestream(this.device.getSerial());
    this.initialize();
  }

  private onStationLivestreamStop(station: Station, device: Device) {
    if (device.getSerial() === this.device.getSerial()) {
      this.console.info(station.getName() + ' station livestream for ' + device.getName() + ' has stopped.');
      this.proxyStreams.forEach((proxyStream) => {
        proxyStream.audiostream.stopProxyStream();
        proxyStream.videostream.stopProxyStream();
        this.removeProxyStream(proxyStream.id);
      });
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
      videostream.on('data', (data) => {
        if(this.isIFrame(data)) { // cache iFrames to speed up livestream encoding
          this.iFrameCache = [data];
        } else if (this.iFrameCache.length > 0) {
          this.iFrameCache.push(data);
        }

        this.proxyStreams.forEach((proxyStream) => {
          proxyStream.videostream.newVideoData(data);
        });
      });
      videostream.on('error', (error) => {
        this.console.error(this.device.getName(), 'Local videostream had Error: ' + error);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      videostream.on('end', () => {
        this.console.debug(this.device.getName(), 'Local videostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      audiostream.on('data', (data) => {       
        this.proxyStreams.forEach((proxyStream) => {
          proxyStream.audiostream.newAudioData(data);
        });
      });
      audiostream.on('error', (error) => {
        this.console.error(this.device.getName(), 'Local audiostream had Error: ' + error);
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });
      audiostream.on('end', () => {
        this.console.debug(this.device.getName(), 'Local audiostream has ended. Clean up.');
        this.stopAllProxyStreams();
        this.stopLocalLiveStream();
      });

      this.console.info(station.getName() + ' station livestream (P2P session) for ' + device.getName() + ' has started.');
      this.livestreamStartedAt = Date.now();
      const createdAt = Date.now();
      this.stationStream = {station, device, metadata, videostream, audiostream, createdAt};
      this.console.debug(this.device.getName(), 'Stream metadata: ' + JSON.stringify(this.stationStream.metadata));
      
      this.emit('livestream start');
    }
  }

  private getProxyStream(): ProxyStream | null {
    if (this.stationStream) {
      const id = this.livestreamCount;
      this.livestreamCount++;
      if (this.livestreamCount > 1024) {
        this.livestreamCount = 1;
      }
      const videostream = new VideostreamProxy(id, this.iFrameCache, this, this.console);
      const audiostream = new AudiostreamProxy(this.console);
      const proxyStream = { id, videostream, audiostream };
      this.proxyStreams.add(proxyStream);
      return proxyStream;
    } else {
      return null;
    }
  }

  public stopProxyStream(id: number): void {
    this.proxyStreams.forEach((pStream) => {
      if (pStream.id === id) {
        pStream.audiostream.stopProxyStream();
        pStream.videostream.stopProxyStream();
        this.removeProxyStream(id);
      }
    });
  }

  private stopAllProxyStreams(): void {
    this.proxyStreams.forEach((proxyStream) => {
      this.stopProxyStream(proxyStream.id);
    });
  }

  private removeProxyStream(id: number): void {
    let proxyStream: ProxyStream | null = null;
    this.proxyStreams.forEach((pStream) => {
      if (pStream.id === id) {
        proxyStream = pStream;
      }
    });
    if (proxyStream !== null) {
      this.proxyStreams.delete(proxyStream);

      this.console.debug(this.device.getName(), 'One stream instance (id: ' + id + ') released livestream. There are now ' +
                    this.proxyStreams.size + ' instance(s) using the livestream.');
      if(this.proxyStreams.size === 0) {
        this.console.debug(this.device.getName(), 'All proxy instances to the livestream have terminated.');
        // check if minimum remaining livestream duration is more than 20 percent
        // of maximum streaming duration or at least 20 seconds
        // if so the termination of the livestream is scheduled
        // if a new livestream is initiated in that time (e.g. fetching a snapshot)
        // the cached livestream can be used
        // caching must also be enabled of course
        const maxStreamingDuration = this.client.getCameraMaxLivestreamDuration();
        const runtime = (Date.now() - ((this.livestreamStartedAt !== null) ? this.livestreamStartedAt! : Date.now())) / 1000;
        if (((maxStreamingDuration - runtime) > maxStreamingDuration*0.2) && (maxStreamingDuration - runtime) > 20 && this.cacheEnabled) {
          this.console.debug(
            this.device.getName(),
            'Sufficient remaining livestream duration available. (' + (maxStreamingDuration - runtime) + ' seconds left)');
          this.scheduleLivestreamCacheTermination(Math.floor(maxStreamingDuration - runtime));
        } else {
          // stop livestream immediately
          if (this.cacheEnabled) {
            this.console.debug(this.device.getName(), 'Not enough remaining livestream duration. Emptying livestream cache.');
          }
          this.stopLocalLiveStream();
        }
      }
    }
  }

  private isIFrame(data: Buffer): boolean {
    const validValues = [64, 66, 68, 78, 101, 103];
    if (data !== undefined && data.length > 0) {
      if (data.length >= 5) {
        const startcode = [...data.slice(0, 5)];
        if (validValues.includes(startcode[3]) || validValues.includes(startcode[4])) {
          return true;
        }
      }
    }
    return false;
  }
}
