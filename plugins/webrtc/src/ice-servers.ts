export const turnServer = {
    urls: ["turn:turn.scrypted.app"],
    username: "foo",
    credential: "bar",
};
export const stunServer = {
    urls: ["stun:turn.scrypted.app:3478"],
    username: "foo",
    credential: "bar",
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
