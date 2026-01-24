/**
 * Creates an AU header for AAC frames in MPEG-4 Generic format (RTP)
 * 
 * @param frameSize - Size of the AAC frame in bytes
 * @param auIndex - AU index (default 0 for continuous streams)
 * @param sizeLength - Number of bits for frame size field (default 13)
 * @param indexLength - Number of bits for AU index field (default 3)
 * @returns The AU header as a Buffer
 */
export function createAUHeader(
  frameSize: number,
  auIndex: number = 0,
  sizeLength: number = 13,
  indexLength: number = 3
): Buffer {
  // Calculate total header bits and bytes
  const totalBits = sizeLength + indexLength;
  const totalBytes = Math.ceil(totalBits / 8);

  // Validate inputs
  if (frameSize < 0 || frameSize > ((1 << sizeLength) - 1)) {
    throw new Error(`Frame size ${frameSize} is too large for sizeLength ${sizeLength} (max ${(1 << sizeLength) - 1})`);
  }

  if (auIndex < 0 || auIndex > ((1 << indexLength) - 1)) {
    throw new Error(`AU index ${auIndex} is too large for indexLength ${indexLength} (max ${(1 << indexLength) - 1})`);
  }

  // Combine size and index into a single value
  const combinedValue = (frameSize << indexLength) | auIndex;

  const header = Buffer.alloc(totalBytes);
  header.writeUintBE(combinedValue, 0, totalBytes);

  return header;
}

/**
 * Creates the AU-header-length field (precedes the AU headers in RTP payload)
 * 
 * @param totalAUHeadersBytes - Total bytes of all AU headers combined
 * @returns AU-header-length as a 2-byte Buffer (big-endian)
 */
export function createAUHeaderLength(totalAUHeadersBytes: number): Buffer {
  const headerLengthBits = totalAUHeadersBytes * 8;

  if (headerLengthBits > 65535) {
    throw new Error('Total AU header bits exceeds 16-bit limit');
  }

  // AU-header-length is a 16-bit integer in network byte order (big-endian)
  const lengthHeader = new Buffer(2);
  lengthHeader[0] = (headerLengthBits >> 8) & 0xFF;
  lengthHeader[1] = headerLengthBits & 0xFF;

  return lengthHeader;
}

/**
 * Given raw AAC frames, creates the complete RTP payload with AU headers
 * 
 * @param frames - Array of raw AAC frames (no ADTS headers)
 * @param sizeLength - Number of bits for frame size field (default 13)
 * @param indexLength - Number of bits for AU index field (default 3)
 * @returns Complete RTP payload (AU-header-length + AU headers + raw frames)
 */
export function createAACRTPPayload(
  frames: Buffer[],
  sizeLength: number = 13,
  indexLength: number = 3
): Buffer {
  if (frames.length === 0) {
    throw new Error('No frames provided');
  }

  // Create AU headers for all frames
  const auHeaders: Buffer[] = [];
  let totalAUHeaderBytes = 0;

  for (let i = 0; i < frames.length; i++) {
    const auHeader = createAUHeader(frames[i].length, 0, sizeLength, indexLength);
    auHeaders.push(auHeader);
    totalAUHeaderBytes += auHeader.length;
  }

  // Create AU-header-length field
  const headerLengthField = createAUHeaderLength(totalAUHeaderBytes);

  // Calculate total payload size
  let totalSize = headerLengthField.length + totalAUHeaderBytes;
  for (const frame of frames) {
    totalSize += frame.length;
  }

  // Assemble the payload
  const payload = new Buffer(totalSize);
  let offset = 0;

  // Copy AU-header-length
  payload.set(headerLengthField, offset);
  offset += headerLengthField.length;

  // Copy AU headers
  for (const header of auHeaders) {
    payload.set(header, offset);
    offset += header.length;
  }

  // Copy raw AAC frames
  for (const frame of frames) {
    payload.set(frame, offset);
    offset += frame.length;
  }

  return payload;
}
