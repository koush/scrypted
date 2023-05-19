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

export function isLocalIceTransport(pc: RTCPeerConnection) {
    let isLocalNetwork = true;
    let destinationId: string;
    for (const ice of pc.iceTransports) {
        const { remoteAddr, localCandidate } = (ice.connection as any).nominated[1];
        const [address, port] = remoteAddr;
        if (!destinationId)
            destinationId = address;

        let sameNetwork = false;
        try {
            const localAddress = Object.values(os.networkInterfaces()).flat().find(nif => nif.address === localCandidate.host);
            sameNetwork = ip.cidrSubnet(localAddress.cidr).contains(address);
        }
        catch (e) {
        }

        isLocalNetwork = isLocalNetwork && (ip.isPrivate(address) || sameNetwork);
    }
    console.log('Connection is local network:', isLocalNetwork);
    const ipv4 = ip.isV4Format(destinationId);
    return {
        ipv4,
        isLocalNetwork,
        destinationId,
    };
}

export function logIsLocalIceTransport(console: Console, pc: RTCPeerConnection) {
    const ret = isLocalIceTransport(pc);
    console.log('ice transport', ret);
    console.log('Connection is local network:', ret.isLocalNetwork);
    return ret;
}
