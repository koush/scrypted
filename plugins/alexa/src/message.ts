import crypto from 'crypto';

export function createMessageId() {
    return crypto.randomBytes(8).toString('hex');
}