import assert from 'assert';
import crypto from 'crypto';
import hkdf from "futoin-hkdf";
import tweetnacl from 'tweetnacl';
import { HAPEncryption } from "./eventedhttp";

if (!crypto.getCiphers().includes("chacha20-poly1305")) {
  assert.fail("The cipher 'chacha20-poly1305' is not supported with your current running nodejs version v" + process.version + ". " +
    "At least a nodejs version of v10.17.0 (excluding v11.0 and v11.1) is required!");
}

export function generateCurve25519KeyPair() {
  return tweetnacl.box.keyPair();
}

export function generateCurve25519SharedSecKey(priKey: Uint8Array, pubKey: Uint8Array) {
  return tweetnacl.scalarMult(priKey, pubKey);
}

export function HKDF(hashAlg: string, salt: Buffer, ikm: Buffer, info: Buffer, size: number) {
  return hkdf(ikm, size, { hash: hashAlg, salt: salt, info: info });
}

//Security Layer Enc/Dec

type Count = {
  value: any;
}

export function layerEncrypt(data: Buffer, encryption: HAPEncryption) {
  let result = Buffer.alloc(0);
  const total = data.length;
  for (let offset = 0; offset < total; ) {
    const length = Math.min(total - offset, 0x400);
    const leLength = Buffer.alloc(2);
    leLength.writeUInt16LE(length,0);

    const nonce = Buffer.alloc(8);
    writeUInt64LE(encryption.accessoryToControllerCount++, nonce, 0);

    const encrypted = chacha20_poly1305_encryptAndSeal(encryption.accessoryToControllerKey, nonce, leLength, data.slice(offset, offset + length));
    offset += length;

    result = Buffer.concat([result,leLength,encrypted.ciphertext,encrypted.authTag]);
  }
  return result;
}

export function layerDecrypt(packet: Buffer, encryption: HAPEncryption) {
  if (encryption.incompleteFrame) {
    packet = Buffer.concat([encryption.incompleteFrame, packet]);
    encryption.incompleteFrame = undefined;
  }

  let result = Buffer.alloc(0);
  const total = packet.length;

  for (let offset = 0; offset < total;) {
    const realDataLength = packet.slice(offset, offset + 2).readUInt16LE(0);

    const availableDataLength = total - offset - 2 - 16;
    if (realDataLength > availableDataLength) { // Fragmented packet
      encryption.incompleteFrame = packet.slice(offset);
      break;
    }

    const nonce = Buffer.alloc(8);
    writeUInt64LE(encryption.controllerToAccessoryCount++, nonce, 0);

    const plaintext = chacha20_poly1305_decryptAndVerify(encryption.controllerToAccessoryKey, nonce, packet.slice(offset,offset+2), packet.slice(offset + 2, offset + 2 + realDataLength), packet.slice(offset + 2 + realDataLength, offset + 2 + realDataLength + 16));
    result = Buffer.concat([result, plaintext]);
    offset += (18 + realDataLength);
  }

  return result;
}

export function chacha20_poly1305_decryptAndVerify(key: Buffer, nonce: Buffer, aad: Buffer | null, ciphertext: Buffer, authTag: Buffer): Buffer {
  // @ts-ignore types for this a really broken
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength:16 });
  if (aad) {
    decipher.setAAD(aad);
  }
  decipher.setAuthTag(authTag);
  const plaintext = decipher.update(ciphertext);
  decipher.final(); // final call verifies integrity using the auth tag. Throws error if something was manipulated!

  return plaintext;
}

export function chacha20_poly1305_encryptAndSeal(key: Buffer, nonce: Buffer, aad: Buffer | null, plaintext: Buffer): { ciphertext: Buffer, authTag: Buffer } {
  // @ts-ignore types for this a really broken
  const cipher = crypto.createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });

  if (aad) {
    cipher.setAAD(aad);
  }

  const ciphertext = cipher.update(plaintext);
  cipher.final(); // final call creates the auth tag
  const authTag = cipher.getAuthTag();

  return { // return type is a bit weird, but we gonna change that on a later code cleanup
    ciphertext: ciphertext,
    authTag: authTag,
  };
}

const MAX_UINT32 = 0x00000000FFFFFFFF;
const MAX_INT53 = 0x001FFFFFFFFFFFFF;

function onesComplement(number: number) {
  number = ~number
  if (number < 0) {
    number = (number & 0x7FFFFFFF) + 0x80000000
  }
  return number
}

function uintHighLow(number: number) {
  assert(number > -1 && number <= MAX_INT53, "number out of range")
  assert(Math.floor(number) === number, "number must be an integer")
  let high = 0;
  const signbit = number & 0xFFFFFFFF;
  const low = signbit < 0 ? (number & 0x7FFFFFFF) + 0x80000000 : signbit;
  if (number > MAX_UINT32) {
    high = (number - low) / (MAX_UINT32 + 1)
  }
  return [high, low]
}

function intHighLow(number: number) {
  if (number > -1) {
    return uintHighLow(number)
  }
  const hl = uintHighLow(-number);
  let high = onesComplement(hl[0]);
  let low = onesComplement(hl[1]);
  if (low === MAX_UINT32) {
    high += 1
    low = 0
  }
  else {
    low += 1
  }
  return [high, low]
}

function writeUInt64BE(number: number, buffer: Buffer, offset: number = 0) {
  const hl = uintHighLow(number);
  buffer.writeUInt32BE(hl[0], offset)
  buffer.writeUInt32BE(hl[1], offset + 4)
}

export function writeUInt64LE (number: number, buffer: Buffer, offset: number = 0) {
  const hl = uintHighLow(number);
  buffer.writeUInt32LE(hl[1], offset)
  buffer.writeUInt32LE(hl[0], offset + 4)
}
