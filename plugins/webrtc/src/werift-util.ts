import { RTCSessionDescription } from "@koush/werift";

export function createRawResponse(response: RTCSessionDescription): RTCSessionDescriptionInit {
    return {
        type: response.type,
        sdp: response.sdp,
    };
}
