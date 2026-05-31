// https://github.com/kevinGodell/pipe2jpeg/blob/master/index.js

import { Transform, TransformCallback } from 'stream';

const _SOI = Buffer.from([0xff, 0xd8]); // jpeg start of image ff08
const _EOI = Buffer.from([0xff, 0xd9]); // jpeg end of image ff09

export class Pipe2Jpeg extends Transform {
  _chunks: Buffer[] = [];
  _size: number = 0;
  _jpeg: Buffer;

  get jpeg() {
    return this._jpeg;
  }

  _sendJpeg() {
    this.emit('jpeg', this._jpeg);
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
    const chunkLength = chunk.length;
    let pos = 0;
    while (true) {
      if (this._size) {
        const eoi = chunk.indexOf(_EOI);
        if (eoi === -1) {
          this._chunks.push(chunk);
          this._size += chunkLength;
          break;
        } else {
          pos = eoi + 2;
          const sliced = chunk.slice(0, pos);
          this._chunks.push(sliced);
          this._size += sliced.length;
          this._jpeg = Buffer.concat(this._chunks, this._size);
          this._chunks = [];
          this._size = 0;
          this._sendJpeg();
          if (pos === chunkLength) {
            break;
          }
        }
      } else {
        const soi = chunk.indexOf(_SOI, pos);
        if (soi === -1) {
          break;
        } else {
          // todo might add option or take sample average / 2 to jump position for small gain
          pos = soi + 500;
        }
        const eoi = chunk.indexOf(_EOI, pos);
        if (eoi === -1) {
          const sliced = chunk.slice(soi);
          this._chunks = [sliced];
          this._size = sliced.length;
          break;
        } else {
          pos = eoi + 2;
          this._jpeg = chunk.slice(soi, pos);
          this._sendJpeg();
          if (pos === chunkLength) {
            break;
          }
        }
      }
    }
    callback();
  }
}
