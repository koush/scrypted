import { RTCIceServer, RTCPeerConnection, RTCSessionDescription } from "@koush/werift";
import ip from 'ip';

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

export function logIsPrivateIceTransport(console: Console, pc: RTCPeerConnection) {
    let isPrivate = true;
    let destinationId: string;
    for (const ice of pc.iceTransports) {
        const [address, port] = (ice.connection as any).nominated[1].remoteAddr;
        if (!destinationId)
            destinationId = address;
        const { turnServer } = ice.connection;
        isPrivate = isPrivate && ip.isPrivate(address);
        console.log('ice transport ip', {
            address,
            port,
            turnServer: !!turnServer,
        });
        if (turnServer)
            console.warn('Turn server is in use. For optimal performance ensure that your router supports source NAT.');
    }
    console.log('Connection is local network:', isPrivate);
    const ipv4 = ip.isV4Format(destinationId);
    return {
        ipv4,
        isPrivate,
        destinationId,
    };
}
