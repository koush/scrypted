import sdk from '@scrypted/sdk';
import { isLoopback, isV4Format, isV6Format } from 'ip';
import dgram from 'node:dgram';

const MAX_RETRIES = 10;
const RETRY_DELAY_SEC = 10;

export async function localServiceIpAddress (doorbellIp: string): Promise<string>
{
    const typeCheck = isV4Format (doorbellIp) ? isV4Format : isV6Format;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++)
    {
        try
        {
            const addresses = await sdk.endpointManager.getLocalAddresses();

            for (const address of addresses || [])
            {
                if (!isLoopback (address) && typeCheck (address))
                {
                    return address;
                }
            }
        }
        catch (e) {
        }

        // Wait before retry if addresses not available yet
        if (attempt < MAX_RETRIES - 1) {
            await awaitTimeout (RETRY_DELAY_SEC * 1000);
        }
    }

    throw new Error('Could not find local service IP address');
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
