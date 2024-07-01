import sdk from '@scrypted/sdk';
import { isLoopback, isV4Format, isV6Format } from 'ip';
import dgram from 'node:dgram';

export async function localServiceIpAddress (doorbellIp: string): Promise<string>
{
    let host = "localhost";
    try {
        const typeCheck = isV4Format (doorbellIp) ? isV4Format : isV6Format;
        for (const address of await sdk.endpointManager.getLocalAddresses()) {
            if (!isLoopback(address) && typeCheck(address)) {
                host = address;
                break;
            }
        }
    }
    catch (e) {
    }

    return host;
}

export function udpSocketType (ip: string): dgram.SocketType {
    return isV4Format (ip) ? 'udp4' : 'udp6';
}

export function rString() {
    const crypto = require('crypto');
    return crypto.randomBytes(10).toString('hex');
}

export function unq(a) {
    if(a && a[0] === '"' && a[a.length-1] === '"')
      return a.substr(1, a.length - 2);
    return a;
  }
  
export function q(a) {
    if(typeof a === 'string' && a[0] !== '"')
      return ['"', a, '"'].join('');
    return a;
  }
  
export let awaitTimeout = delay =>
  new Promise(resolve => setTimeout(resolve, delay));


export function timeOutPromise<R> (timeoutMs: number, timeoutResult: R, executor)
{
    const wait = new Promise<R> (executor)
    return Promise.race ([wait, awaitTimeout(timeoutMs).then (()=> timeoutResult)]);
}
