import { v4 as generateRandomUuid, v5 as generateUuidFromNamespace } from 'uuid'

const uuidNamespace = 'e53ffdc0-e91d-4ce1-bec2-df939d94739d'

export function generateUuid(seed?: string) {
  if (seed) {
    return generateUuidFromNamespace(seed, uuidNamespace)
  }

  return generateRandomUuid()
}

export function randomInteger() {
  return Math.floor(Math.random() * 99999999) + 100000
}

export function randomString(length: number) {
  const uuid = generateUuid()
  return uuid.replace(/-/g, '').substring(0, length).toLowerCase()
}
