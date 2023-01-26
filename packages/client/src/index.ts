import { RTCConnectionManagement, RTCSignalingSession, ScryptedStatic } from "@scrypted/types";
import axios, { AxiosRequestConfig } from 'axios';
import * as eio from 'engine.io-client';
import { SocketOptions } from 'engine.io-client';
import { Deferred } from "../../../common/src/deferred";
import { timeoutFunction, timeoutPromise } from "../../../common/src/promise-utils";
import { BrowserSignalingSession, waitPeerConnectionIceConnected, waitPeerIceConnectionClosed } from "../../../common/src/rtc-signaling";
import { DataChannelDebouncer } from "../../../plugins/webrtc/src/datachannel-debouncer";
import type { IOSocket } from '../../../server/src/io';
import type { MediaObjectRemote } from '../../../server/src/plugin/plugin-api';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
import { createRpcDuplexSerializer, createRpcSerializer } from '../../../server/src/rpc-serializer';
import packageJson from '../package.json';

type IOClientSocket = eio.Socket & IOSocket;

function once(socket: IOClientSocket, event: 'open' | 'message') {
    return new Promise<any[]>((resolve, reject) => {
        const err = (e: any) => {
            cleanup();
            reject(e);
        };
        const e = (...args: any[]) => {
            cleanup();
            resolve(args);
        };
        const cleanup = () => {
            socket.removeListener('error', err);
            socket.removeListener(event, e);
        };
        socket.once('error', err);
        socket.once(event, e);
    });
}

export type ScryptedClientConnectionType = 'http' | 'webrtc' | 'http-direct';

export interface ScryptedClientStatic extends ScryptedStatic {
    userId?: string;
    username?: string;
    disconnect(): void;
    onClose?: Function;
    version: string;
    rtcConnectionManagement?: RTCConnectionManagement;
    browserSignalingSession?: BrowserSignalingSession;
    address?: string;
    connectionType: ScryptedClientConnectionType;
    authorization?: string;
    queryToken?: { [parameter: string]: string };
}

export interface ScryptedConnectionOptions {
    direct?: boolean;
    webrtc?: boolean;
    baseUrl?: string;
    axiosConfig?: AxiosRequestConfig;
}

export interface ScryptedLoginOptions extends ScryptedConnectionOptions {
    username: string;
    /**
     * The password, or preferably, login token for logging into Scrypted.
     * The login token can be retrieved with "npx scrypted login".
     */
    password: string;
    change_password?: string,
    maxAge?: number;
}

export interface ScryptedClientOptions extends Partial<ScryptedLoginOptions> {
    pluginId: string;
    clientName?: string;
    transports?: string[];
}

function isRunningStandalone() {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.userAgent.includes('InstalledApp');
}

export async function logoutScryptedClient(baseUrl?: string) {
    const url = baseUrl ? new URL('/logout', baseUrl).toString() : '/logout';
    const response = await axios(url, {
        withCredentials: true,
    });
    return response.data;
}

export async function loginScryptedClient(options: ScryptedLoginOptions) {
    let { baseUrl, username, password, change_password, maxAge } = options;
    // pwa should stay logged in for a year.
    if (!maxAge && isRunningStandalone())
        maxAge = 365 * 24 * 60 * 60 * 1000;

    const url = `${baseUrl || ''}/login`;
    const response = await axios.post(url, {
        username,
        password,
        change_password,
        maxAge,
    }, {
        withCredentials: true,
        ...options.axiosConfig,
    });

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    const addresses = response.data.addresses as string[] || [];
    // the cloud plugin will include this header.
    // should maybe move this into the cloud server itself.
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';
    const directAddress = response.headers['x-scrypted-direct-address'];

    return {
        error: response.data.error as string,
        authorization: response.data.authorization as string,
        queryToken: response.data.queryToken as any,
        token: response.data.token as string,
        addresses,
        scryptedCloud,
        directAddress,
    };
}

export async function checkScryptedClientLogin(options?: ScryptedConnectionOptions) {
    let { baseUrl } = options || {};
    const url = `${baseUrl || ''}/login`;
    const response = await axios.get(url, {
        withCredentials: true,
        ...options?.axiosConfig,
    });
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';
    const directAddress = response.headers['x-scrypted-direct-address'];

    return {
        redirect: response.data.redirect as string,
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
        error: response.data.error as string,
        authorization: response.data.authorization as string,
        queryToken: response.data.queryToken as any,
        addresses: response.data.addresses as string[],
        scryptedCloud,
        directAddress,
    };
}

export class ScryptedClientLoginError extends Error {
    constructor(public result: Awaited<ReturnType<typeof checkScryptedClientLogin>>) {
        super(result.error);
    }
}

export function redirectScryptedLogin(options?: {
    redirect?: string, baseUrl?: string
}) {
    let { baseUrl, redirect } = options || {};
    redirect = redirect || `/endpoint/@scrypted/core/public/`
    if (baseUrl) {
        const url = new URL(redirect, baseUrl);
        url.searchParams.set('redirect_uri', window.location.href);
        redirect = url.toString();
    }
    else {
        redirect = `${redirect}?redirect_uri=${encodeURIComponent(window.location.href)}`;
    }
    const redirect_uri = redirect;
    console.log('redirect_uri', redirect_uri);
    globalThis.location.href = redirect_uri;
}

export async function redirectScryptedLogout(baseUrl?: string) {
    baseUrl = baseUrl || '';
    globalThis.location.href = `${baseUrl}/logout`;
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    const start = Date.now();
    let { baseUrl, pluginId, clientName, username, password } = options;
    let authorization: string;
    let queryToken: any;

    const extraHeaders: { [header: string]: string } = {};
    let addresses: string[];
    let scryptedCloud: boolean;
    let directAddress: string;

    console.log('@scrypted/client', packageJson.version);

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);
        if (loginResult.authorization)
            extraHeaders['Authorization'] = loginResult.authorization;
        addresses = loginResult.addresses;
        scryptedCloud = loginResult.scryptedCloud;
        authorization = loginResult.authorization;
        queryToken = loginResult.queryToken;
        console.log('login result', Date.now() - start, loginResult);
    }
    else {
        const loginCheck = await checkScryptedClientLogin({
            baseUrl,
        });
        if (loginCheck.error || loginCheck.redirect)
            throw new ScryptedClientLoginError(loginCheck);
        addresses = loginCheck.addresses;
        scryptedCloud = loginCheck.scryptedCloud;
        directAddress = loginCheck.directAddress;
        username = loginCheck.username;
        authorization = loginCheck.authorization;
        queryToken = loginCheck.queryToken;
        console.log('login checked', Date.now() - start, loginCheck);
    }

    let socket: IOClientSocket;
    const endpointPath = `/endpoint/${pluginId}`;
    const eioOptions: Partial<SocketOptions> = {
        path: `${endpointPath}/engine.io/api`,
        withCredentials: true,
        extraHeaders,
        rejectUnauthorized: false,
        transports: options?.transports,
    };

    const explicitBaseUrl = baseUrl || `${globalThis.location.protocol}//${globalThis.location.host}`;

    let rpcPeer: RpcPeer;
    // underlying webrtc rpc transport may queue up messages before its ready to be to be handled.
    // watch for this flush.
    const flush = new Deferred<void>();

    if (directAddress) {
        addresses ||= [];
        addresses.push(directAddress);
    }
    const tryLocalAddressess = options.direct && scryptedCloud && !!addresses.length;
    const tryWebrtc = !!globalThis.RTCPeerConnection && (scryptedCloud && options.webrtc === undefined) || options.webrtc;

    const localEioOptions: Partial<SocketOptions> = {
        ...eioOptions,
        extraHeaders: {
            ...eioOptions.extraHeaders,
        },
    };

    // cross origin requests will not send cookies, so must send the authorization header.
    // note that cross origin websockets do not support extra headers, so the conneciton
    // must be initiated with polling transport first to establish a session.
    localEioOptions.extraHeaders['Authorization'] ||= authorization;

    let sockets: IOClientSocket[] = [];
    type EIOResult = { ready: IOClientSocket, connectionType: ScryptedClientConnectionType, address?: string };
    const promises: Promise<EIOResult>[] = [];

    if (tryLocalAddressess) {
        // creating a LAN API connection is supported, but it typically does not work
        // because the self signed cert has not been accepted, or not on the local network at all.
        // It is probably better to simply prompt and redirect to the LAN address
        // if it is reacahble.

        for (const address of addresses) {
            console.log('trying', address);
            const check = new eio.Socket(address, localEioOptions);
            sockets.push(check);
            promises.push((async () => {
                await once(check, 'open');
                return {
                    connectionType: 'http-direct',
                    ready: check,
                    address,
                };
            })());
        }
    }

    if (tryWebrtc) {
        console.log('trying webrtc');
        const webrtcEioOptions: Partial<SocketOptions> = {
            path: '/endpoint/@scrypted/webrtc/engine.io/',
            withCredentials: true,
            extraHeaders,
            rejectUnauthorized: false,
            transports: options?.transports,
        };
        const check = new eio.Socket(explicitBaseUrl, webrtcEioOptions);
        sockets.push(check);
        promises.push((async () => {
            await once(check, 'open');
            return {
                ready: check,
                connectionType: 'webrtc',
            };
        })());
    }

    const p2pPromises = [...promises];

    promises.push((async () => {
        const waitDuration = tryWebrtc ? 10000 : (tryLocalAddressess ? 1000 : 0);
        if (waitDuration) {
            // give the peer to peers a second, but then try connecting directly.
            try {
                const any = Promise.any(p2pPromises);
                await timeoutPromise(waitDuration, any);
                console.log('found direct connection, aborting scrypted cloud connection')
                return;
            }
            catch (e) {
                // timeout or all failures
            }
        }
        const check = new eio.Socket(explicitBaseUrl, eioOptions);
        sockets.push(check);

        await once(check, 'open');
        return {
            ready: check,
            connectionType: 'http',
        };
    })());

    const any = Promise.any(promises);
    const { ready, connectionType, address } = await any;

    console.log('connected', connectionType, address)

    if (connectionType === 'webrtc') {
        console.log('using peer to peer', Date.now() - start);

        const connectionManagementId = `connectionManagement-${Math.random()}`;
        const updateSessionId = `updateSessionId-${Math.random()}`;
        ready.send(JSON.stringify({
            pluginId,
            updateSessionId,
            connectionManagementId,
        }));
        const dcDeferred = new Deferred<RTCDataChannel>();
        const session = new BrowserSignalingSession();
        const droppedMessages: any[] = [];
        session.onPeerConnection = async pc => {
            pc.ondatachannel = e => {
                e.channel.onmessage = message => droppedMessages.push(message);
                e.channel.binaryType = 'arraybuffer';
                dcDeferred.resolve(e.channel)
            };
        }
        const pcPromise = session.pcDeferred.promise;

        const serializer = createRpcSerializer({
            sendMessageBuffer: buffer => ready.send(buffer),
            sendMessageFinish: message => ready.send(JSON.stringify(message)),
        });
        const upgradingPeer = new RpcPeer(clientName || 'webrtc-upgrade', "api", (message, reject, serializationContext) => {
            try {
                serializer.sendMessage(message, reject, serializationContext);
            }
            catch (e) {
                reject?.(e);
            }
        });

        ready.on('message', data => {
            if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
                serializer.onMessageBuffer(Buffer.from(data));
            }
            else {
                serializer.onMessageFinish(JSON.parse(data as string));
            }
        });
        serializer.setupRpcPeer(upgradingPeer);

        const readyClose = new Promise<RpcPeer>((resolve, reject) => {
            ready.on('close', () => reject(new Error('closed')))
        })

        upgradingPeer.params['session'] = session;

        rpcPeer = await Promise.race([readyClose, timeoutFunction(10000, async (isTimedOut) => {
            const pc = await pcPromise;
            console.log('peer connection received');

            await waitPeerConnectionIceConnected(pc);
            console.log('waiting for data channel');

            const dc = await dcDeferred.promise;
            console.log('datachannel received', Date.now() - start);

            const debouncer = new DataChannelDebouncer(dc, e => {
                console.error('datachannel send error', e);
                ret.kill('datachannel send error');
            });
            const serializer = createRpcDuplexSerializer({
                write: (data) => debouncer.send(data),
            });

            while (droppedMessages.length) {
                const message = droppedMessages.shift();
                dc.dispatchEvent(message);
            }

            const ret = new RpcPeer('webrtc-client', "api", (message, reject, serializationContext) => {
                try {
                    serializer.sendMessage(message, reject, serializationContext);
                }
                catch (e) {
                    reject?.(e);
                    pc.close();
                }
            });
            serializer.setupRpcPeer(ret);

            ret.params['connectionManagementId'] = connectionManagementId;
            ret.params['updateSessionId'] = updateSessionId;
            ret.params['browserSignalingSession'] = session;

            waitPeerIceConnectionClosed(pc).then(() => ready.close());
            ready.on('close', () => {
                console.log('datachannel upgrade cancelled/closed');
                pc.close()
            });

            await new Promise(resolve => {
                let buffers: Buffer[] = [];
                dc.onmessage = message => {
                    buffers.push(Buffer.from(message.data));
                    resolve(undefined);

                    flush.promise.finally(() => {
                        if (buffers) {
                            for (const buffer of buffers) {
                                serializer.onData(Buffer.from(buffer));
                            }
                            buffers = undefined;
                        }
                        dc.onmessage = message => serializer.onData(Buffer.from(message.data));
                    });
                };
            });

            if (isTimedOut()) {
                console.log('peer connection established too late. closing.', Date.now() - start);
                ready.close();
            }
            else {
                console.log('peer connection api connected', Date.now() - start);
            }
            return ret;
        })]);
    }

    socket = ready;
    sockets = sockets.filter(s => s !== ready);

    sockets.forEach(s => {
        try {
            s.close();
        }
        catch (e) {
        }
    });

    try {
        if (!rpcPeer) {
            const serializer = createRpcSerializer({
                sendMessageBuffer: buffer => socket.send(buffer),
                sendMessageFinish: message => socket.send(JSON.stringify(message)),
            });

            rpcPeer = new RpcPeer(clientName || 'engine.io-client', "api", (message, reject, serializationContext) => {
                try {
                    serializer.sendMessage(message, reject, serializationContext);
                }
                catch (e) {
                    reject?.(e);
                }
            });
            socket.on('message', data => {
                if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
                    serializer.onMessageBuffer(Buffer.from(data));
                }
                else {
                    serializer.onMessageFinish(JSON.parse(data as string));
                }
            });
            serializer.setupRpcPeer(rpcPeer);
        }

        setTimeout(() => flush.resolve(undefined), 0);
        const scrypted = await attachPluginRemote(rpcPeer, undefined);
        const {
            serverVersion,
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
        } = scrypted;
        console.log('api attached', Date.now() - start);

        mediaManager.createMediaObject = async (data, mimeType, options) => {
            const mo: MediaObjectRemote & {
                [RpcPeer.PROPERTY_PROXY_PROPERTIES]: any,
                [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
            } = {
                [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
                [RpcPeer.PROPERTY_PROXY_PROPERTIES]: {
                    mimeType,
                    sourceId: options?.sourceId,
                },
                mimeType,
                sourceId: options?.sourceId,
                async getData() {
                    return data;
                },
            };
            return mo;
        }

        const { browserSignalingSession, connectionManagementId, updateSessionId } = rpcPeer.params;
        if (updateSessionId && browserSignalingSession) {
            systemManager.getComponent('plugins').then(async plugins => {
                const updateSession: (session: RTCSignalingSession) => Promise<void> = await plugins.getHostParam('@scrypted/webrtc', updateSessionId);
                if (!updateSession)
                    return;
                await updateSession(browserSignalingSession);
                console.log('signaling channel upgraded.');
                socket.removeAllListeners();
                socket.close();
            });
        }

        const [version, rtcConnectionManagement] = await Promise.all([
            (async () => {
                let version = 'unknown';
                try {
                    const info = await systemManager.getComponent('info');
                    version = await info.getVersion();
                }
                catch (e) {
                }
                return version;
            })(),
            (async () => {
                let rtcConnectionManagement: RTCConnectionManagement;
                if (connectionManagementId) {
                    try {
                        const plugins = await systemManager.getComponent('plugins');
                        rtcConnectionManagement = await plugins.getHostParam('@scrypted/webrtc', connectionManagementId);
                        return rtcConnectionManagement;
                    }
                    catch (e) {
                    }
                }
            })(),
        ]);

        console.log('api initialized', Date.now() - start);
        console.log('api queried, version:', version);

        const userDevice = Object.keys(systemManager.getSystemState())
            .map(id => systemManager.getDeviceById(id))
            .find(device => device.pluginId === '@scrypted/core' && device.nativeId === `user:${username}`);

        const ret: ScryptedClientStatic = {
            userId: userDevice?.id,
            serverVersion,
            username,
            pluginRemoteAPI: undefined,
            address,
            connectionType,
            version,
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            disconnect() {
                rpcPeer.kill('disconnect requested');
            },
            pluginHostAPI: undefined,
            rtcConnectionManagement,
            browserSignalingSession,
            authorization,
            queryToken,
        }

        socket.on('close', () => {
            rpcPeer.kill('socket closed');
        });

        rpcPeer.killed.finally(() => {
            socket.close();
            ret.onClose?.();
        });

        return ret;
    }
    catch (e) {
        socket.close();
        throw e;
    }
}
