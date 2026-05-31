/**
 * FLV Audio/Video tag payload parser
 * RTMP messages for audio (type 8) and video (type 9) contain FLV tag payloads
 */

// ============================================================================
// Video Tag Types (in FLV header, byte 0, low nibble)
// ============================================================================
export enum VideoCodecId {
  JPEG = 1,
  SORENSON_H263 = 2,
  SCREEN_VIDEO = 3,
  ON2_VP6 = 4,
  ON2_VP6_WITH_ALPHA = 5,
  SCREEN_VIDEO_V2 = 6,
  H264 = 7,
}

// ============================================================================
// Video Frame Types (in FLV header, byte 0, high nibble)
// ============================================================================
export enum VideoFrameType {
  KEY = 1,              // Keyframe (I-frame)
  INTER = 2,            // Inter frame (P-frame)
  DISPOSABLE_INTER = 3, // Disposable inter frame
  GENERATED_KEYFRAME = 4,
  VIDEO_INFO = 5,       // Video info/command frame
}

// ============================================================================
// AVC Packet Types (byte 1 for H.264 codec)
// ============================================================================
export enum AVC_PACKET_TYPE {
  SEQUENCE_HEADER = 0,  // AVC sequence header (decoder configuration)
  NALU = 1,             // AVC NALU unit
  END_OF_SEQUENCE = 2,  // AVC end of sequence
}

// ============================================================================
// Audio Sound Formats (in FLV header, byte 0, top 4 bits)
// ============================================================================
export enum AudioSoundFormat {
  PCM_BE = 0,
  ADPCM = 1,
  MP3 = 2,
  PCM_LE = 3,
  NELLYMOSER_16K = 4,
  NELLYMOSER_8K = 5,
  NELLYMOSER = 6,
  G711_A = 7,
  G711_U = 8,
  AAC = 10,
  SPEEX = 11,
  MP3_8K = 14,
}

// ============================================================================
// Audio Sound Rates (in FLV header, byte 0, bits 2-3)
// ============================================================================
export enum AudioSoundRate {
  _5_5KHZ = 0,
  _11KHZ = 1,
  _22KHZ = 2,
  _44KHZ = 3,
}

// ============================================================================
// Audio Sound Size (in FLV header, byte 0, bit 1)
// ============================================================================
export enum AudioSoundSize {
  SAMPLE_8BIT = 0,
  SAMPLE_16BIT = 1,
}

// ============================================================================
// Audio Sound Type (in FLV header, byte 0, bit 0)
// ============================================================================
export enum AudioSoundType {
  MONO = 0,
  STEREO = 1,
}

// ============================================================================
// AAC Packet Types (byte 1 for AAC codec)
// ============================================================================
export enum AAC_PACKET_TYPE {
  SEQUENCE_HEADER = 0,  // AAC sequence header (AudioSpecificConfig)
  RAW = 1,               // AAC raw data
}

// ============================================================================
// Parsed Video Tag Structure
// ============================================================================
export interface FlvVideoTag {
  frameType: VideoFrameType;
  codecId: VideoCodecId;

  // H.264 specific
  avcPacketType?: AVC_PACKET_TYPE;
  compositionTime?: number;

  // H.264 sequence header
  avcDecoderConfigurationRecord?: {
    configurationVersion: number;
    avcProfileIndication: number;
    profileCompatibility: number;
    avcLevelIndication: number;
    lengthSizeMinusOne: number;  // NALU length = (value & 0x03) + 1
    sps: Buffer[];               // Sequence parameter sets
    pps: Buffer[];               // Picture parameter sets
  };

  // H.264 NALU data
  nalus?: Buffer[];

  // Raw payload (for non-H.264 codecs)
  rawPayload?: Buffer;
}

// ============================================================================
// Parsed Audio Tag Structure
// ============================================================================
export interface FlvAudioTag {
  soundFormat: AudioSoundFormat;
  soundRate: AudioSoundRate;
  soundSize: AudioSoundSize;
  soundType: AudioSoundType;

  // AAC specific
  aacPacketType?: AAC_PACKET_TYPE;

  // AAC sequence header (AudioSpecificConfig)
  audioSpecificConfig?: {
    audioObjectType: number;
    samplingFrequencyIndex: number;
    channelConfiguration: number;
  };

  // Raw audio data
  data: Buffer;
}

// ============================================================================
// Parser Result
// ============================================================================
export type FlvTag = FlvVideoTag | FlvAudioTag;

// ============================================================================
// Parse AVCDecoderConfigurationRecord (H.264 decoder configuration)
// ============================================================================
function parseAVCDecoderConfigurationRecord(buffer: Buffer, offset: number, length: number): {
  config: FlvVideoTag['avcDecoderConfigurationRecord'],
  bytesConsumed: number
} {
  if (length < 6) {
    throw new Error('AVCDecoderConfigurationRecord too short');
  }

  const config: FlvVideoTag['avcDecoderConfigurationRecord'] = {
    configurationVersion: buffer[offset],
    avcProfileIndication: buffer[offset + 1],
    profileCompatibility: buffer[offset + 2],
    avcLevelIndication: buffer[offset + 3],
    lengthSizeMinusOne: buffer[offset + 4] & 0x03,
    sps: [],
    pps: [],
  };

  const numSPS = buffer[offset + 5] & 0x1F;
  let pos = offset + 6;

  // Parse SPS
  for (let i = 0; i < numSPS; i++) {
    if (pos + 2 > buffer.length) {
      throw new Error('AVCDecoderConfigurationRecord truncated reading SPS length');
    }
    const spsLength = buffer.readUInt16BE(pos);
    pos += 2;

    if (pos + spsLength > buffer.length) {
      throw new Error(`AVCDecoderConfigurationRecord: SPS data exceeds buffer length`);
    }

    config.sps.push(buffer.subarray(pos, pos + spsLength));
    pos += spsLength;
  }

  // Parse PPS
  if (pos >= buffer.length) {
    return { config, bytesConsumed: pos - offset };
  }

  const numPPS = buffer[pos];
  pos++;

  for (let i = 0; i < numPPS; i++) {
    if (pos + 2 > buffer.length) {
      throw new Error('AVCDecoderConfigurationRecord truncated reading PPS length');
    }
    const ppsLength = buffer.readUInt16BE(pos);
    pos += 2;

    if (pos + ppsLength > buffer.length) {
      throw new Error(`AVCDecoderConfigurationRecord: PPS data exceeds buffer length`);
    }

    config.pps.push(buffer.subarray(pos, pos + ppsLength));
    pos += ppsLength;
  }

  return { config, bytesConsumed: pos - offset };
}

// ============================================================================
// Parse H.264 NALU units from AVCPacketType=1 payload
// The NALUs are preceded by length fields (size = lengthSizeMinusOne + 1)
// ============================================================================
function parseNALUUnits(buffer: Buffer, offset: number, length: number, naluLengthSize: number): Buffer[] {
  const nalus: Buffer[] = [];
  let pos = offset;

  if (naluLengthSize < 1 || naluLengthSize > 4) {
    throw new Error(`Invalid NALU length size: ${naluLengthSize}`);
  }

  while (pos + naluLengthSize <= offset + length) {
    const naluLength = buffer.readUintBE(pos, naluLengthSize);
    pos += naluLengthSize;

    if (naluLength === 0) {
      continue; // Skip zero-length NALUs
    }

    if (pos + naluLength > offset + length) {
      throw new Error(`NALU data exceeds buffer length at position ${pos}`);
    }

    nalus.push(buffer.subarray(pos, pos + naluLength));
    pos += naluLength;
  }

  return nalus;
}

// ============================================================================
// Parse AudioSpecificConfig (AAC decoder configuration)
// ============================================================================
function parseAudioSpecificConfig(buffer: Buffer, offset: number, length: number): {
  aacConfig: FlvAudioTag['audioSpecificConfig'],
  bytesConsumed: number
} {
  if (length < 2) {
    throw new Error('AudioSpecificConfig too short');
  }

  // AudioSpecificConfig is 2+ bytes, bit-packed
  const byte0 = buffer[offset];
  const byte1 = buffer[offset + 1];

  const aacConfig: FlvAudioTag['audioSpecificConfig'] = {
    audioObjectType: (byte0 >> 3) & 0x1F,
    samplingFrequencyIndex: ((byte0 & 0x07) << 1) | ((byte1 >> 7) & 0x01),
    channelConfiguration: (byte1 >> 3) & 0x0F,
  };

  return { aacConfig, bytesConsumed: 2 };
}

// ============================================================================
// Parse FLV Video Tag Payload
// ============================================================================
export function parseFlvVideoTag(buffer: Buffer): FlvVideoTag {
  if (buffer.length < 1) {
    throw new Error('Video tag too short');
  }

  const byte0 = buffer[0];
  const frameType = (byte0 >> 4) as VideoFrameType;
  const codecId = (byte0 & 0x0F) as VideoCodecId;

  const result: FlvVideoTag = {
    frameType,
    codecId,
  };

  if (codecId === VideoCodecId.H264) {
    // H.264/AVC codec
    if (buffer.length < 5) {
      throw new Error('H.264 video tag too short');
    }

    result.avcPacketType = buffer[1] as AVC_PACKET_TYPE;
    result.compositionTime = buffer.readIntBE(2, 3);

    switch (result.avcPacketType) {
      case AVC_PACKET_TYPE.SEQUENCE_HEADER: {
        const data = buffer.subarray(5);
        const parsed = parseAVCDecoderConfigurationRecord(data, 0, data.length);
        result.avcDecoderConfigurationRecord = parsed.config;
        break;
      }

      case AVC_PACKET_TYPE.NALU: {
        // Need to know NALU length size from the sequence header
        // We'll assume 4 bytes (most common) if not provided
        const naluLengthSize = 4;
        const data = buffer.subarray(5);
        result.nalus = parseNALUUnits(data, 0, data.length, naluLengthSize);
        break;
      }

      case AVC_PACKET_TYPE.END_OF_SEQUENCE:
        // No payload
        break;
    }
  } else {
    // Other video codecs - just return raw payload
    result.rawPayload = buffer.subarray(1);
  }

  return result;
}

// ============================================================================
// Parse FLV Audio Tag Payload
// ============================================================================
export function parseFlvAudioTag(buffer: Buffer): FlvAudioTag {
  if (buffer.length < 1) {
    throw new Error('Audio tag too short');
  }

  const byte0 = buffer[0];
  const soundFormat: AudioSoundFormat = (byte0 >> 4) & 0x0F;
  const soundRate: AudioSoundRate = (byte0 >> 2) & 0x03;
  const soundSize: AudioSoundSize = (byte0 >> 1) & 0x01;
  const soundType: AudioSoundType = byte0 & 0x01;

  const result: FlvAudioTag = {
    soundFormat,
    soundRate,
    soundSize,
    soundType,
    data: Buffer.alloc(0),
  };

  if (soundFormat === AudioSoundFormat.AAC) {
    if (buffer.length < 2) {
      throw new Error('AAC audio tag too short');
    }

    result.aacPacketType = buffer[1] as AAC_PACKET_TYPE;

    if (result.aacPacketType === AAC_PACKET_TYPE.SEQUENCE_HEADER) {
      const data = buffer.subarray(2);
      const parsed = parseAudioSpecificConfig(data, 0, data.length);
      result.audioSpecificConfig = parsed.aacConfig;
    } else {
      result.data = buffer.subarray(2);
    }
  } else {
    // Raw audio data for other formats
    result.data = buffer.subarray(1);
  }

  return result;
}

// ============================================================================
// Parse FLV Tag (auto-detect video or audio based on codec/format)
// This function requires you to know the RTMP message type (8=audio, 9=video)
// ============================================================================
export function parseFlvTag(buffer: Buffer, messageType: number): FlvTag {
  if (messageType === 9) {
    return parseFlvVideoTag(buffer);
  } else if (messageType === 8) {
    return parseFlvAudioTag(buffer);
  } else {
    throw new Error(`Unsupported message type for FLV parsing: ${messageType}`);
  }
}

// ============================================================================
// Parse H.264 NALU unit type (5-bit value in first byte's low bits)
// ============================================================================
export function parseNALUHeader(buffer: Buffer): number {
  if (buffer.length < 1) {
    throw new Error('NALU too short');
  }
  return buffer[0] & 0x1F;
}

// ============================================================================
// Helper: Format H.264 NALU unit type name
// ============================================================================
export function getNALUTypeName(nalcType: number): string {
  const types: Record<number, string> = {
    1: 'slice_layer_without_partitioning_non_idr',
    5: 'slice_layer_without_partitioning_idr',
    6: 'sei',
    7: 'seq_parameter_set',
    8: 'pic_parameter_set',
    9: 'access_unit_delimiter',
  };
  return types[nalcType] || `unknown (${nalcType})`;
}