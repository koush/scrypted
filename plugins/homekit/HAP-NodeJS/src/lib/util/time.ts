import assert from "assert";
import { readUInt64BE } from "./tlv";

const EPOCH_MILLIS_2001_01_01 = Date.UTC(2001, 0, 1, 0, 0, 0, 0);

export function epochMillisFromMillisSince2001_01_01Buffer(millis: Buffer): number {
  assert(millis.length === 8, "can only parse 64 bit buffers!");
  const millisSince2001 = readUInt64BE(millis);
  return epochMillisFromMillisSince2001_01_01(millisSince2001);
}

export function epochMillisFromMillisSince2001_01_01(millis: number): number {
  return EPOCH_MILLIS_2001_01_01 + millis;
}
