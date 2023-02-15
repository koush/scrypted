const server = "turn.scrypted.app:3478";
const turn = `turn:${server}`;
const stun = `stun:${server}`;
const creds = {
    username: "foo",
    credential: "bar",
};

export const turnServer = {
    urls: [turn],
    ...creds,
};
export const stunServer = {
    urls: [stun],
    ...creds,
};
const googleStunServer = {
    urls: ["stun:stun.l.google.com:19302"],
};
export const turnIceServers = [
    googleStunServer,
    turnServer,
];
export const stunIceServers = [
    googleStunServer,
];

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

export const weriftTurnServer = toWerift(turnServer);
export const weriftStunServer = toWerift(stunServer);

