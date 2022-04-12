function ExpGolomInit(view: DataView, bitoffset: number): { zeros: number; skip: number; byt: number; byteoffset: number } {
    let bit = 0;
    let byteoffset = bitoffset >> 3;
    let skip = bitoffset & 7;
    let zeros = -1;
  
    let byt = view.getUint8(byteoffset) << skip;
    do {
      bit = byt & 0x80;
      byt <<= 1;
      zeros++;
      skip++;
      if (skip === 8) {
        skip = 0;
        byteoffset++;
        byt = view.getUint8(byteoffset);
      }
    } while (!bit);
  
    return { zeros, skip, byt, byteoffset };
  }
  
  export class Bitstream {
    public bitoffset = 0;
      constructor (public view: DataView) {}
  
    ExpGolomb(): number {
      const { view } = this;
      let {
        zeros, skip, byt, byteoffset,
      } = ExpGolomInit(view, this.bitoffset);
      
      let code = 1;
      while (zeros > 0) {
        code = (code << 1) | ((byt & 0x80) >>> 7);
        byt <<= 1;
        skip++;
        zeros--;
        if (skip === 8) {
          skip = 0;
          byteoffset++;
          byt = view.getUint8(byteoffset);
        }
      }
      
      this.bitoffset = (byteoffset << 3) | skip;
      return code - 1;
    }
  
    SignedExpGolomb(): number {
      const code = this.ExpGolomb();
      return code & 1 ? (code + 1) >>> 1 : -(code >>> 1);
    }
  
    readBit(): 0 | 1 {
      const skip = this.bitoffset & 7;
      const byteoffset = this.bitoffset >> 3;
      this.bitoffset++;
      return ((this.view.getUint8(byteoffset) >> (7 - skip)) & 1) as 0|1;
    }
    
    readByte(): number {
      const skip = this.bitoffset & 7;
      const byteoffset = this.bitoffset >> 3;
      this.bitoffset += 8;
  
      const high = this.view.getUint8(byteoffset);
      if (skip === 0) return high;
  
      const low = this.view.getUint8(byteoffset + 1);
  
      return (high << skip) | (low >> (8 - skip));
    }
  }
  