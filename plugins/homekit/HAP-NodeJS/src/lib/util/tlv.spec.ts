import { decode, encode } from './tlv';

describe('#encode()', () => {

  it('encodes a single value correctly in the TLV format', () => {
    const encoded = encode(0, Buffer.from('ASD'))

    const result = decode(encoded);
    expect(result[0].toString()).toEqual('ASD');
  });

  it('encodes multiple values correctly in the TLV format', () => {
    const encoded = encode(0, Buffer.from('ASD'), 1, Buffer.from('QWE'))

    const result = decode(encoded);
    expect(result[0].toString()).toEqual('ASD');
    expect(result[1].toString()).toEqual('QWE');
  });
});

describe('#decode()', () => {
});
