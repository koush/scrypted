import { RTCIceServer, RTCPeerConnection, RTCSessionDescription } from "./werift";
import ip from 'ip';
import os from 'os';

export function createRawResponse(response: RTCSessionDescription): RTCSessionDescriptionInit {
    return {
        type: response.type,
        sdp: response.sdp,
    };
}

export function isPeerConnectionAlive(pc: RTCPeerConnection) {
    if (pc.iceConnectionState === 'disconnected'
        || pc.iceConnectionState === 'failed'
        || pc.iceConnectionState === 'closed')
        return false;
    if (pc.connectionState === 'closed'
        || pc.connectionState === 'disconnected'
        || pc.connectionState === 'failed')
        return false;
    return true;
}

export function getWeriftIceServers(configuration: RTCConfiguration): RTCIceServer[] {
    if (!configuration?.iceServers)
        return;
    const ret: RTCIceServer[] = [];
    for (const ice of configuration.iceServers) {
        if (typeof ice.urls === 'string') {
            ret.push({
                ...ice as RTCIceServer,
            });
        }
        else {
            for (const url of ice.urls) {
                ret.push(Object.assign({}, ice, {
                    urls: url,
                }));
            }
        }
    }

    return ret;
}

// node-ip is missing this range.
// https://en.wikipedia.org/wiki/Reserved_IP_addresses
const additionalPrivate = ip.cidrSubnet('198.18.0.0/15');
function isPrivate(address: string) {
    return ip.isPrivate(address) || additionalPrivate.contains(address);
}

export function isLocalIceTransport(pc: RTCPeerConnection) {
    let isLocalNetwork = true;
    let destinationId: string;
    let type: string;
    for (const ice of pc.iceTransports) {
        const { remoteAddr, localCandidate, remoteCandidate } = (ice.connection as any).nominated;
        const [address, port] = remoteAddr;
        type = remoteCandidate.type;
        if (!destinationId)
            destinationId = address;

        let sameNetwork = false;
        try {
            const localAddress = Object.values(os.networkInterfaces()).flat().find(nif => nif.address === localCandidate.host);
            sameNetwork = ip.cidrSubnet(localAddress.cidr).contains(address);
        }
        catch (e) {
        }

        isLocalNetwork = isLocalNetwork && (isPrivate(address) || sameNetwork);
    }
    const ipv4 = ip.isV4Format(destinationId);
    return {
        ipv4,
        type,
        isLocalNetwork,
        destinationId,
    };
}

export function logIsLocalIceTransport(console: Console, pc: RTCPeerConnection) {
    const ret = isLocalIceTransport(pc);
    console.log('Connection is local network:', ret.isLocalNetwork, ret.destinationId, ret);
    return ret;
}
