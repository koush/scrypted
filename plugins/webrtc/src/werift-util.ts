import { RTCIceServer, RTCPeerConnection, RTCSessionDescription } from "@koush/werift";

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
