import { Readable } from 'stream';
import { once } from 'events';

export async function read16BELengthLoop(readable: Readable, options: {
  headerLength: number;
  offset?: number;
  // optionally skip a header, and pause loop parsing until calee resumes.
  skipHeader?: (header: Buffer, resumeRead: () => void) => boolean;
  callback: (header: Buffer, data: Buffer) => void;
}) {
  let error: Error;
  const { skipHeader, callback } = options;
  const offset = options.offset || 0;
  const headerLength = options.headerLength || 2;

  readable.on('error', e => error = e);

  let header: Buffer;
  let length: number;
  let skipCount = 0;
  let readCount = 0;

  const resumeRead = () => {
    readCount++;
    read();
  }

  const read = () => {
    while (true) {
      if (skipCount !== readCount)
        return;
      if (!header) {
        header = readable.read(headerLength);
        if (!header)
          return;
        if (skipHeader?.(header, resumeRead)) {
          skipCount++;
          header = undefined;
          continue;
        }
        length = header.readUInt16BE(offset);
      }
      else {
        const data = readable.read(length);
        if (!data)
          return;
        callback(header, data);
        header = undefined;
      }
    }
  };

  read();
  readable.on('readable', read);

  await Promise.any([once(readable, 'end'), once(readable, 'close').catch(() => { })]);
  throw new StreamEndError('read16BELengthLoop');
}

export class StreamEndError extends Error {
  constructor(where: string) {
    super(`stream ended: ${where}`);
  }
}

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
  if (readable.readableEnded || readable.destroyed)
    throw new StreamEndError('readLength start');

  if (!length) {
    return Buffer.alloc(0);
  }

  {
    const ret = readable.read(length);
    if (ret) {
      return ret;
    }
  }

  return new Promise((resolve, reject) => {
    const r = () => {
      const ret = readable.read(length);
      if (ret) {
        cleanup();
        resolve(ret);
        return;
      }

      if (readable.readableEnded || readable.destroyed)
        reject(new StreamEndError('readLength readable'));
    };

    const e = () => {
      cleanup();
      reject(new StreamEndError('readLength done'));
    };

    const cleanup = () => {
      readable.removeListener('readable', r);
      readable.removeListener('close', e);
      readable.removeListener('end', e);
    }

    readable.on('readable', r);
    readable.on('close', e);
    readable.on('end', e);
  });
}

const CHARCODE_NEWLINE = '\n'.charCodeAt(0);

/**
 * Read up to (not including) the next occurrence of charCode, returning the raw bytes.
 * The delimiter itself is consumed and discarded.
 */
export async function readUntilBuffer(readable: Readable, charCode: number): Promise<Buffer> {
  const queued: Buffer[] = [];
  while (true) {
    const available: Buffer = readable.read();
    if (!available) {
      await once(readable, 'readable');
      continue;
    }
    const index = available.findIndex(b => b === charCode);
    if (index === -1) {
      queued.push(available);
      continue;
    }

    const before = available.subarray(0, index);
    queued.push(before);

    const after = available.subarray(index + 1);
    readable.unshift(after);
    return Buffer.concat(queued);
  }
}

export async function readUntil(readable: Readable, charCode: number) {
  return (await readUntilBuffer(readable, charCode)).toString();
}

/**
 * Read one line as raw bytes. The terminating LF is consumed and not returned;
 * a preceding CR, if any, is returned.
 */
export async function readLineBuffer(readable: Readable) {
  return readUntilBuffer(readable, CHARCODE_NEWLINE);
}

export async function readLine(readable: Readable) {
  return readUntil(readable, CHARCODE_NEWLINE);
}

/**
 * Format bytes for diagnostics. Printable ASCII is kept, CR, LF and TAB are shown as
 * escapes so line structure is unambiguous, everything else is shown as \xNN.
 * A hex dump follows. Intended for error messages and opt-in debug logging.
 */
export function formatRawBytes(buffer: Buffer, maxLength = 512): string {
  const shown = buffer.subarray(0, maxLength);
  let escaped = '';
  for (const c of shown) {
    if (c === 13)
      escaped += '\\r';
    else if (c === 10)
      escaped += '\\n\n';
    else if (c === 9)
      escaped += '\\t';
    else if (c >= 32 && c < 127)
      escaped += String.fromCharCode(c);
    else
      escaped += '\\x' + c.toString(16).padStart(2, '0');
  }
  const hexLines: string[] = [];
  for (let i = 0; i < shown.length; i += 16) {
    const chunk = shown.subarray(i, i + 16);
    const hex = [...chunk].map(c => c.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map(c => c >= 32 && c < 127 ? String.fromCharCode(c) : '.').join('');
    hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  const truncated = buffer.length > shown.length ? `\n... ${buffer.length - shown.length} more bytes not shown` : '';
  return `${escaped}\n${hexLines.join('\n')}${truncated}`;
}

export async function readString(readable: Readable | Promise<Readable>) {
  const buffer = await readBuffer(readable);
  return buffer.toString();
}

export async function readBuffer(readable: Readable | Promise<Readable>) {
  const buffers: Buffer[] = [];
  readable = await readable;
  readable.on('data', buffer => {
    buffers.push(buffer);
  });
  readable.resume();
  await Promise.any([once(readable, 'end'), once(readable, 'close').catch(() => { })]);
  return Buffer.concat(buffers);
}
