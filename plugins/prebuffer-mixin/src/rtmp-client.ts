import { readLength } from '@scrypted/common/src/read-stream';
import { Socket } from 'net';

function writeUInt24BE(buffer: Buffer, value: number, offset: number): void {
  buffer[offset] = (value >> 16) & 0xFF;
  buffer[offset + 1] = (value >> 8) & 0xFF;
  buffer[offset + 2] = value & 0xFF;
}

// Constants
const HANDSHAKE_SIZE = 1536;
const RTMP_VERSION = 3;

// Chunk format types
enum ChunkFormat {
  TYPE_0 = 0,
  TYPE_1 = 1,
  TYPE_2 = 2,
  TYPE_3 = 3
}

// RTMP message types
enum RtmpMessageType {
  CHUNK_SIZE = 1,
  ABORT = 2,
  ACKNOWLEDGEMENT = 3,
  USER_CONTROL = 4,
  WINDOW_ACKNOWLEDGEMENT_SIZE = 5,
  SET_PEER_BANDWIDTH = 6,
  AUDIO = 8,
  VIDEO = 9,
  DATA_AMF0 = 18,
  COMMAND_AMF0 = 20
}

// Control messages
export class SetChunkSize {
  constructor(public chunkSize: number) { }
}

export class UserControlSetBufferLength {
  constructor(public streamId: number, public bufferLength: number) { }
}

export interface CreateStreamResult {
  streamId: number;
}

export interface OnStatusResult {
  level: string;
  code: string;
  description: string;
}

interface ChunkStream {
  chunkStreamId: number;
  messageStreamId: number;
  messageLength: number;
  messageTypeId: number;
  timestamp: number;
  sequenceNumber: number;
  messageData: Buffer[];
  totalReceived: number;
  hasExtendedTimestamp: boolean;
}

export class RtmpClient {
  socket: Socket | null = null;
  private chunkSize: number = 128;
  private outgoingChunkSize: number = 128;
  private windowAckSize: number = 5000000;
  private streamId: number = 0;
  private lastAcknowledgementBytes: number = 0;
  private totalBytesReceived: number = 0;
  private transactionId: number = 1;
  private chunkStreams: Map<number, ChunkStream> = new Map();

  constructor(public url: string, public console?: Console) {
    this.socket = new Socket();

  }

  async setup() {
    this.console?.log('Starting stream()...');
    await this.connect();

    // Send connect command
    this.console?.log('Sending connect command...');
    await this.sendConnect();
    this.console?.log('Connect command sent');

    while (true) {
      const msg = await this.readMessage();
      const { messageTypeId } = msg.chunkStream;
      if (messageTypeId === RtmpMessageType.WINDOW_ACKNOWLEDGEMENT_SIZE) {
        continue;
      }
      if (messageTypeId === RtmpMessageType.SET_PEER_BANDWIDTH) {
        continue;
      }
      if (messageTypeId === RtmpMessageType.CHUNK_SIZE) {
        const newChunkSize = msg.message.readUInt32BE(0);
        this.console?.log(`Server set chunk size to ${newChunkSize}`);
        this.chunkSize = newChunkSize;
        continue;
      }
      if (messageTypeId === RtmpMessageType.COMMAND_AMF0) {
        // Parse AMF0 command
        // For simplicity, we only handle _result for connect here
        const commandName = msg.message.subarray(3, 10).toString('utf8');
        if (commandName === '_result') {
          this.console?.log('Received _result for connect');
          break;
        }
        throw new Error(`Unexpected command: ${commandName}`);
      }
      throw new Error(`Unexpected message type: ${messageTypeId}`);
    }

    // Send window acknowledgement size
    this.sendWindowAckSize(5000000);

    // Send createStream
    this.console?.log('Sending createStream...');
    this.streamId = await this.sendCreateStream();

    // Wait for _result for createStream
    const createStreamResult = await this.readMessage();
    // check it
    const { messageTypeId } = createStreamResult.chunkStream;
    if (messageTypeId !== RtmpMessageType.COMMAND_AMF0) {
      throw new Error(`Unexpected message type waiting for createStream result: ${messageTypeId}, expected COMMAND_AMF0`);
    }
    this.console?.log('Got createStream _result');

    // Send getStreamLength then play (matching ffmpeg's order)
    const parsedUrl = new URL(this.url);
    // Extract stream name (after /app/)
    const parts = parsedUrl.pathname.split('/');
    const streamName = parts.length > 2 ? parts.slice(2).join('/') : '';
    const playPath = streamName + parsedUrl.search;

    this.console?.log('Sending getStreamLength with path:', playPath);
    const getStreamLengthData = this.encodeAMF0Command('getStreamLength', this.transactionId++, null, playPath);
    this.sendMessage(5, 0, RtmpMessageType.COMMAND_AMF0, 0, getStreamLengthData);

    this.console?.log('Sending play command with path:', playPath);
    this.sendPlay(this.streamId, playPath);

    this.console?.log('Sending setBufferLength...');
    this.setBufferLength(this.streamId, 3000);
  }

  /**
   * Connect to the RTMP server and start streaming
   */
  async *readLoop(): AsyncGenerator<{
    packet: Buffer,
    codec: string,
    timestamp: number,
  }> {
    this.console?.log('Starting to yield video/audio packets...');
    // Just yield video/audio packets as they arrive
    while (true) {
      const msg = await this.readMessage();
      if (msg.chunkStream.messageTypeId === RtmpMessageType.VIDEO) {
        yield { packet: msg.message, codec: 'video', timestamp: msg.chunkStream.timestamp };
      } else if (msg.chunkStream.messageTypeId === RtmpMessageType.AUDIO) {
        yield { packet: msg.message, codec: 'audio', timestamp: msg.chunkStream.timestamp };
      }
      else {
        this.console?.warn(`Ignoring message type ${msg.chunkStream.messageTypeId}`);
      }
    }
  }

  /**
   * Connect to RTMP server
   */
  private async connect(): Promise<void> {
    const parsedUrl = new URL(this.url);
    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port) || 1935;

    this.console?.log(`Connecting to RTMP server at ${host}:${port}`);

    // Add socket event listeners
    this.socket.on('close', (hadError) => {
      this.console?.log(`Socket closed, hadError=${hadError}`);
    });
    this.socket.on('end', () => {
      this.console?.log('Socket received FIN');
    });
    this.socket.on('error', (err) => {
      this.console?.error('Socket error:', err);
    });

    await new Promise<void>((resolve, reject) => {
      this.socket!.connect(port, host, () => {
        this.console?.log('Socket connected');
        resolve();
      });

      this.socket!.once('error', reject);
    });

    this.console?.log('Performing handshake...');
    await this.performHandshake();
    this.console?.log('Handshake complete');
  }

  /**
   * Perform RTMP handshake
   * Client sends: C0 + C1
   * Server responds: S0 + S1 + S2
   * Client responds: C2
   */
  private async performHandshake(): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected');

    // Send C0 (1 byte: version)
    const c0 = Buffer.from([RTMP_VERSION]);

    // Send C1 (1536 bytes: time[4] + zero[4] + random[1528])
    const c1 = Buffer.alloc(HANDSHAKE_SIZE);
    const timestamp = Math.floor(Date.now() / 1000);
    c1.writeUInt32BE(timestamp, 0);
    c1.writeUInt32BE(0, 4); // zero

    // Send C0 + C1
    this.socket.write(Buffer.concat([c0, c1]));

    // Read S0 (1 byte)
    const s0 = await this.readExactly(1);
    const serverVersion = s0[0];
    if (serverVersion !== RTMP_VERSION) {
      throw new Error(`Unsupported RTMP version: ${serverVersion}`);
    }

    // Read S1 (1536 bytes)
    const s1 = await this.readExactly(HANDSHAKE_SIZE);
    const s1Time = s1.readUInt32BE(0);

    // Read S2 (1536 bytes)
    const s2 = await this.readExactly(HANDSHAKE_SIZE);

    // Send C2 (echo of S1)
    const c2 = s1;

    this.socket.write(c2);
  }

  /**
   * Parse RTMP chunks after handshake
   */
  private async readMessage(): Promise<{
    message: Buffer,
    chunkStream: ChunkStream,
  }> {
    const stream = this.socket!;

    while (true) {
      // Read chunk basic header (1-3 bytes)
      const basicHeader = await readLength(stream, 1);
      const fmt = (basicHeader[0] >> 6) & 0x03;
      let csId = basicHeader[0] & 0x3F;

      // Handle 2-byte and 3-byte forms
      if (csId === 0) {
        const secondByte = await readLength(stream, 1);
        csId = secondByte[0] + 64;
      } else if (csId === 1) {
        const bytes = await readLength(stream, 2);
        csId = (bytes[1] << 8) | bytes[0] + 64;
      }

      // Chunk stream ID 2 is reserved for protocol control messages, but we should still parse it

      // Get or create chunk stream state
      let chunkStream = this.chunkStreams.get(csId);
      if (!chunkStream) {
        chunkStream = {
          chunkStreamId: csId,
          messageStreamId: 0,
          messageLength: 0,
          messageTypeId: 0,
          timestamp: 0,
          sequenceNumber: 0,
          messageData: [],
          totalReceived: 0,
          hasExtendedTimestamp: false
        };
        this.chunkStreams.set(csId, chunkStream);
      }

      // Parse message header based on format
      let timestamp: number;
      let messageLength: number;
      let messageTypeId: number;
      let messageStreamId: number;
      let hasExtendedTimestamp = false;
      let headerSize: number;

      if (fmt === ChunkFormat.TYPE_0) {
        // Type 0: 11 bytes
        headerSize = 11;
        const header = await readLength(stream, 11);
        timestamp = header.readUIntBE(0, 3);
        messageLength = header.readUIntBE(3, 3);
        messageTypeId = header[6];
        messageStreamId = header.readUInt32LE(7);

        // Update chunk stream state
        chunkStream.messageStreamId = messageStreamId;
        chunkStream.messageLength = messageLength;
        chunkStream.messageTypeId = messageTypeId;
        chunkStream.timestamp = timestamp;
        chunkStream.totalReceived = 0;
        chunkStream.messageData = [];

        if (timestamp >= 0xFFFFFF) {
          hasExtendedTimestamp = true;
          chunkStream.hasExtendedTimestamp = true;
        }

      } else if (fmt === ChunkFormat.TYPE_1) {
        // Type 1: 7 bytes
        headerSize = 7;
        const header = await readLength(stream, 7);
        const timestampDelta = header.readUIntBE(0, 3);
        messageLength = header.readUIntBE(3, 3);
        messageTypeId = header[6];

        // Update chunk stream state
        chunkStream.messageLength = messageLength;
        chunkStream.messageTypeId = messageTypeId;
        chunkStream.timestamp += timestampDelta;
        chunkStream.totalReceived = 0;
        chunkStream.messageData = [];

        if (timestampDelta >= 0xFFFFFF) {
          hasExtendedTimestamp = true;
          chunkStream.hasExtendedTimestamp = true;
        }

      } else if (fmt === ChunkFormat.TYPE_2) {
        // Type 2: 3 bytes
        headerSize = 3;
        const header = await readLength(stream, 3);
        const timestampDelta = header.readUIntBE(0, 3);

        // Update chunk stream state
        chunkStream.timestamp += timestampDelta;
        chunkStream.totalReceived = 0;
        chunkStream.messageData = [];

        if (timestampDelta >= 0xFFFFFF) {
          hasExtendedTimestamp = true;
          chunkStream.hasExtendedTimestamp = true;
        }

      } else {
        headerSize = 0;
        // Type 3: 0 bytes - use previous values
        if (chunkStream.totalReceived === 0) {
          throw new Error('Type 3 chunk but no previous chunk in stream');
        }
      }

      // Read extended timestamp if present
      if (hasExtendedTimestamp || chunkStream.hasExtendedTimestamp) {
        const extTs = await readLength(stream, 4);
        const extendedTimestamp = extTs.readUInt32BE(0);

        if (fmt === ChunkFormat.TYPE_0) {
          chunkStream.timestamp = extendedTimestamp;
        } else if (fmt === ChunkFormat.TYPE_1 || fmt === ChunkFormat.TYPE_2) {
          // For type 1 and 2, the extended timestamp replaces the delta
          chunkStream.timestamp = chunkStream.timestamp - (fmt === ChunkFormat.TYPE_1 ? (await readLength(stream, 0)).readUIntBE(0, 3) : 0) + extendedTimestamp;
        }
      }

      // Calculate chunk data size
      const remainingInMessage = chunkStream.messageLength - chunkStream.totalReceived;
      const chunkDataSize = Math.min(this.chunkSize, remainingInMessage);

      const MAX_CHUNK_SIZE = 1024 * 1024;
      if (chunkDataSize > MAX_CHUNK_SIZE) {
        throw new Error(`Chunk size ${chunkDataSize} exceeds maximum allowed size of ${MAX_CHUNK_SIZE} bytes`);
      }

      // Read chunk data
      const chunkData = await readLength(stream, chunkDataSize);
      chunkStream.messageData.push(chunkData);
      chunkStream.totalReceived += chunkDataSize;

      // Track bytes received for window acknowledgements
      // Count: basic header (1 byte) + message header (0-11 bytes) + extended timestamp (0-4 bytes) + payload
      const extTimestampSize = (hasExtendedTimestamp || chunkStream.hasExtendedTimestamp) ? 4 : 0;
      const bytesInChunk = 1 + headerSize + extTimestampSize + chunkDataSize;
      this.totalBytesReceived += bytesInChunk;

      // Send window acknowledgement if threshold exceeded
      this.sendAcknowledgementIfNeeded();

      // Check if message is complete
      if (chunkStream.totalReceived >= chunkStream.messageLength) {
        const message = Buffer.concat(chunkStream.messageData);
        chunkStream.messageData = [];
        chunkStream.totalReceived = 0;
        chunkStream.hasExtendedTimestamp = false;
        return {
          chunkStream,
          message,
        };
      }
    }
  }

  /**
   * Send acknowledgement if window threshold exceeded
   */
  private sendAcknowledgementIfNeeded(): void {
    const bytesToAck = this.totalBytesReceived - this.lastAcknowledgementBytes;
    if (bytesToAck >= this.windowAckSize) {
      this.lastAcknowledgementBytes = this.totalBytesReceived;
      console.log(`Sending acknowledgement: ${this.lastAcknowledgementBytes} bytes received (${bytesToAck} since last ACK)`);
      const data = Buffer.alloc(4);
      data.writeUInt32BE(this.lastAcknowledgementBytes & 0xFFFFFFFF, 0);
      this.sendMessage(2, 0, RtmpMessageType.ACKNOWLEDGEMENT, 0, data);
    }
  }

  /**
   * Read exactly n bytes from socket
   */
  private async readExactly(n: number): Promise<Buffer> {
    return readLength(this.socket!, n);
  }

  /**
   * Encode value to AMF0
   */
  private encodeAMF0(value: any): Buffer {
    if (typeof value === 'number') {
      const buf = Buffer.alloc(9);
      buf[0] = 0x00; // Number marker
      buf.writeDoubleBE(value, 1);
      return buf;
    } else if (typeof value === 'string') {
      const buf = Buffer.alloc(3 + value.length);
      buf[0] = 0x02; // String marker
      buf.writeUInt16BE(value.length, 1);
      buf.write(value, 3, 'utf8');
      return buf;
    } else if (typeof value === 'boolean') {
      const buf = Buffer.alloc(2);
      buf[0] = 0x01; // Boolean marker
      buf[1] = value ? 1 : 0;
      return buf;
    } else if (value === null || value === undefined) {
      return Buffer.from([0x05]); // Null marker
    } else if (typeof value === 'object') {
      // Object
      const parts: Buffer[] = [Buffer.from([0x03])]; // Object marker

      for (const [key, val] of Object.entries(value)) {
        // Key
        const keyBuf = Buffer.alloc(2 + key.length);
        keyBuf.writeUInt16BE(key.length, 0);
        keyBuf.write(key, 2, 'utf8');
        parts.push(keyBuf);

        // Value
        parts.push(this.encodeAMF0(val));
      }

      // End of object marker
      parts.push(Buffer.from([0x00, 0x00, 0x09]));

      return Buffer.concat(parts);
    }

    throw new Error(`Unsupported AMF0 type: ${typeof value}`);
  }

  /**
   * Encode command to AMF0
   */
  private encodeAMF0Command(commandName: string, transactionId: number, commandObject: any, ...args: any[]): Buffer {
    const parts: Buffer[] = [];

    // Command name (string)
    parts.push(this.encodeAMF0(commandName));

    // Transaction ID (number)
    parts.push(this.encodeAMF0(transactionId));

    // Command object
    parts.push(this.encodeAMF0(commandObject));

    // Additional arguments
    for (const arg of args) {
      parts.push(this.encodeAMF0(arg));
    }

    return Buffer.concat(parts);
  }

  /**
   * Send a message as RTMP chunks
   */
  private sendMessage(
    chunkStreamId: number,
    messageStreamId: number,
    messageTypeId: number,
    timestamp: number,
    data: Buffer
  ): void {
    if (!this.socket) throw new Error('Socket not connected');

    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < data.length) {
      const chunkDataSize = Math.min(this.outgoingChunkSize, data.length - offset);
      const isType0 = offset === 0;

      // Type 0 header is 12 bytes (1 + 3 + 3 + 1 + 4)
      const headerSize = isType0 ? 12 : 1;
      const header = Buffer.alloc(headerSize);

      // Basic header (chunk stream ID)
      if (chunkStreamId < 64) {
        header[0] = (isType0 ? ChunkFormat.TYPE_0 : ChunkFormat.TYPE_3) << 6 | chunkStreamId;
      } else {
        // Handle extended chunk stream IDs (simplified for now)
        header[0] = (isType0 ? ChunkFormat.TYPE_0 : ChunkFormat.TYPE_3) << 6 | 1;
      }

      if (isType0) {
        // Type 0 header
        writeUInt24BE(header, timestamp, 1);
        writeUInt24BE(header, data.length, 4);
        header[7] = messageTypeId;
        header.writeUInt32LE(messageStreamId, 8);
      }

      chunks.push(header);
      chunks.push(data.subarray(offset, offset + chunkDataSize));
      offset += chunkDataSize;
    }

    for (const chunk of chunks) {
      this.socket.write(chunk);
    }
  }

  /**
   * Send connect command
   */
  private async sendConnect(): Promise<void> {
    const parsedUrl = new URL(this.url);
    const tcUrl = `${parsedUrl.protocol}//${parsedUrl.host}/${parsedUrl.pathname.split('/')[1]}`;

    const connectObject = {
      app: parsedUrl.pathname.split('/')[1],
      flashVer: 'LNX 9,0,124,2',
      tcUrl: tcUrl,
      fpad: false,
      capabilities: 15,
      audioCodecs: 4071,
      videoCodecs: 252,
      videoFunction: 1
    };

    const data = this.encodeAMF0Command('connect', this.transactionId++, connectObject);
    this.sendMessage(3, 0, RtmpMessageType.COMMAND_AMF0, 0, data);
  }

  /**
   * Send createStream command
   */
  private async sendCreateStream(): Promise<number> {
    const data = this.encodeAMF0Command('createStream', this.transactionId++, null);
    this.sendMessage(3, 0, RtmpMessageType.COMMAND_AMF0, 0, data);
    return 1;
  }

  /**
   * Send play command
   */
  private sendPlay(streamId: number, playPath: string): void {
    const data = this.encodeAMF0Command('play', this.transactionId++, null, playPath, -2000);
    this.sendMessage(4, streamId, RtmpMessageType.COMMAND_AMF0, 0, data);
  }

  /**
   * Send setBufferLength user control
   */
  private setBufferLength(streamId: number, bufferLength: number): void {
    const data = Buffer.alloc(10);
    data.writeUInt16BE(3, 0);
    data.writeUInt32BE(streamId, 2);
    data.writeUInt32BE(bufferLength, 6);
    this.sendMessage(2, 0, RtmpMessageType.USER_CONTROL, 1, data);
  }

  /**
   * Send window acknowledgement size
   */
  private sendWindowAckSize(windowSize: number): void {
    const data = Buffer.alloc(4);
    data.writeUInt32BE(windowSize, 0);
    this.sendMessage(2, 0, RtmpMessageType.WINDOW_ACKNOWLEDGEMENT_SIZE, 0, data);
  }

  /**
   * Destroy the connection
   */
  destroy() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
