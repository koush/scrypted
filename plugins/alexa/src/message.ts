import {v4 as uuidv4} from 'uuid';

export function createMessageId() {
    return uuidv4();
}