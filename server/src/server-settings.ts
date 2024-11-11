import { getUsableNetworkAddresses } from './ip';

export const SCRYPTED_INSECURE_PORT = parseInt(process.env.SCRYPTED_INSECURE_PORT) || 11080;
export const SCRYPTED_SECURE_PORT = parseInt(process.env.SCRYPTED_SECURE_PORT) || 10443;
export const SCRYPTED_DEBUG_PORT = parseInt(process.env.SCRYPTED_DEBUG_PORT) || 10081;
export const SCRYPTED_CLUSTER_WORKERS = parseInt(process.env.SCRYPTED_CLUSTER_WORKERS) || 32;

export function getIpAddress(): string {
    return getUsableNetworkAddresses()[0];
}
