import { RTCIceServer as WeriftRTCIceServer } from "./werift";

const server = "turn.scrypted.app:3478";
const turn = `turn:${server}`;
const stun = `stun:${server}`;
const creds = {
    username: "foo",
    credential: "bar",
};

const turnServer = {
    urls: [turn],
    ...creds,
};
const stunServer = {
    urls: [stun],
    ...creds,
};
const googleStunServer = {
    urls: ["stun:stun.l.google.com:19302"],
};

function toWerift(s: typeof turnServer | RTCIceServer) {
    return {
        urls: typeof s.urls === 'string' ? s.urls : s.urls[0],
        username: s.username,
        credential: s.credential,
    }
}

export function toWeriftConfiguration(configuration: RTCConfiguration) {
    return {
        iceServers: configuration.iceServers.map(toWerift),
    }
}

export const turnServers = [
    turnServer,
    stunServer,
    googleStunServer,
];

export const stunServers = [
    stunServer,
    googleStunServer,
];

export const weriftTurnServers: WeriftRTCIceServer[] = turnServers.map(toWerift);
export const weriftStunServers: WeriftRTCIceServer[] = stunServers.map(toWerift);
