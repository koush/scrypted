const crypto = require('crypto');

export function generateUuid(seed?: string) {
  return crypto.randomUUID();
}

export function randomInteger() {
  return Math.floor(Math.random() * 99999999) + 100000
}

export function randomString(length: number) {
  const uuid = generateUuid()
  return uuid.replace(/-/g, '').substring(0, length).toLowerCase()
}
