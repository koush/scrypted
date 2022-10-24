import { ScryptedStatic, RTCConnectionManagement, RTCSignalingSession } from "@scrypted/types";
import axios, { AxiosRequestConfig } from 'axios';
import * as eio from 'engine.io-client';
import { SocketOptions } from 'engine.io-client';
import { Deferred } from "../../../common/src/deferred";
import { timeoutFunction, timeoutPromise } from "../../../common/src/promise-utils";
import { BrowserSignalingSession, waitPeerConnectionIceConnected, waitPeerIceConnectionClosed } from "../../../common/src/rtc-signaling";
import { DataChannelDebouncer } from "../../../plugins/webrtc/src/datachannel-debouncer";
import type { IOSocket } from '../../../server/src/io';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
import { createRpcDuplexSerializer, createRpcSerializer } from '../../../server/src/rpc-serializer';

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

export type ScryptedClientConnectionType = 'http' | 'webrtc' | 'http-local';

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
    onClose?: Function;
    userStorage: Storage,
    version: string;
    connectionType: ScryptedClientConnectionType;
    rtcConnectionManagement?: RTCConnectionManagement;
    browserSignalingSession?: BrowserSignalingSession;
}

export interface ScryptedConnectionOptions {
    webrtc?: boolean;
    baseUrl: string;
    axiosConfig?: AxiosRequestConfig;
}

export interface ScryptedLoginOptions extends ScryptedConnectionOptions {
    username: string;
    /**
     * The password, or preferably, login token for logging into Scrypted.
     * The login token can be retrieved with "npx scrypted login".
     */
    password: string;
    change_password: string,
    maxAge?: number;
}

export interface ScryptedClientOptions extends Partial<ScryptedLoginOptions> {
    pluginId: string;
    clientName?: string;
}

function isRunningStandalone() {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches;
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
        ...options.axiosConfig,
    });

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    const addresses = response.data.addresses as string[] || [];
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';

    return {
        authorization: response.data.authorization as string,
        error: response.data.error as string,
        token: response.data.token as string,
        addresses,
        scryptedCloud,
    };
}

export async function checkScryptedClientLogin(options?: ScryptedConnectionOptions) {
    let { baseUrl } = options || {};
    const url = `${baseUrl || ''}/login`;
    const response = await axios.get(url, {
        ...options?.axiosConfig,
    });
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';

    return {
        redirect: response.data.redirect as string,
        error: response.data.error as string,
        authorization: response.data.authorization as string,
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
        addresses: response.data.addresses as string[],
        scryptedCloud,
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
    baseUrl = baseUrl || '';
    redirect = redirect || `${baseUrl}/endpoint/@scrypted/core/public/`
    const redirect_uri = `${redirect}?redirect_uri=${encodeURIComponent(window.location.href)}`;
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

    const extraHeaders: { [header: string]: string } = {};
    let addresses: string[];
    let scryptedCloud: boolean;

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);
        if (loginResult.authorization)
            extraHeaders['Authorization'] = loginResult.authorization;
        addresses = loginResult.addresses;
        scryptedCloud = loginResult.scryptedCloud;
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
        console.log('login checked', Date.now() - start, loginCheck);
    }

    let socket: IOClientSocket;
    const endpointPath = `/endpoint/${pluginId}`;
    const eioOptions: Partial<SocketOptions> = {
        path: `${endpointPath}/engine.io/api`,
        extraHeaders,
        rejectUnauthorized: false,
    };

    const explicitBaseUrl = baseUrl || `${globalThis.location.protocol}//${globalThis.location.host}`;
    let connectionType: ScryptedClientConnectionType;

    let rpcPeer: RpcPeer;
    // underlying webrtc rpc transport may queue up messages before its ready to be to be handled.
    // watch for this flush.
    const flush = new Deferred<void>();

    if (scryptedCloud || options.webrtc) {
        const publicEioOptions: Partial<SocketOptions> = {
            path: `${endpointPath}/public/engine.io/api`,
            extraHeaders,
            rejectUnauthorized: false,
        };

        let sockets: IOClientSocket[] = [];
        type EIOResult = { ready: IOClientSocket, id?: string, webrtc?: boolean, address?: string };
        const promises: Promise<EIOResult>[] = [];

        try {
            // creating a LAN API connection is supported, but does not wok for a few reasons:
            //  * the self signed cert hasn't been accepted.
            //  * safari doesn't support cross domain cookies by default anymore,
            //    so it requires that the engine.io API socket is authenticated
            //    via a reachable authenticated channel. this is a janky process.
            // It is probably better to simply prompt and redirect to the LAN address
            // if it is reacahble.
            addresses = [];

            for (const address of addresses) {
                const check = new eio.Socket(address, publicEioOptions);
                sockets.push(check);
                promises.push((async () => {
                    await once(check, 'open');
                    const [json] = await once(check, 'message');
                    const { id } = JSON.parse(json);
                    return {
                        ready: check,
                        id,
                        address,
                    };
                })());
            }

            if (globalThis.RTCPeerConnection) {
                promises.push((async () => {
                    const webrtcEioOptions: Partial<SocketOptions> = {
                        path: '/endpoint/@scrypted/webrtc/engine.io/',
                        extraHeaders,
                        rejectUnauthorized: false,
                    };
                    const check = new eio.Socket(explicitBaseUrl, webrtcEioOptions);
                    sockets.push(check);

                    await once(check, 'open');
                    return {
                        ready: check,
                        webrtc: true,
                    };
                })());
            }

            const any = Promise.any(promises);
            const { ready, id, webrtc, address } = await timeoutPromise(1000, any);

            if (!webrtc) {
                connectionType = 'http-local';

                console.log('using local address', address);
                const url = `${eioOptions.path}/activate`;
                await axios.post(url, {
                    id,
                }, {
                    ...options.axiosConfig,
                });

                ready.send('/api/start');
            }
            else {
                connectionType = 'webrtc';

                const connectionManagementId = `connectionManagement-${Math.random()}`;
                const updateSessionId = `updateSessionId-${Math.random()}`;
                ready.send(JSON.stringify({
                    pluginId,
                    updateSessionId,
                    connectionManagementId,
                }));
                const dcDeferred = new Deferred<RTCDataChannel>();
                const session = new BrowserSignalingSession();
                session.onPeerConnection = async pc => {
                    pc.ondatachannel = e => {
                        e.channel.onmessage = () => console.log('dropped mesage');
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

                rpcPeer = await Promise.race([readyClose, timeoutFunction(options.webrtc ? 10000 : 2000, async (isTimedOut) => {
                    const pc = await pcPromise;

                    await waitPeerConnectionIceConnected(pc);

                    const dc = await dcDeferred.promise;
                    console.log('datachannel received', Date.now() - start);

                    const debouncer = new DataChannelDebouncer(dc, e => {
                        console.error('datachannel send error', e);
                        ret.kill('datachannel send error');
                    });
                    const serializer = createRpcDuplexSerializer({
                        write: (data) => debouncer.send(data),
                    });

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
        }
        catch (e) {
            console.error('peer to peer failed', Date.now() - start, e);
        }
        sockets.forEach(s => {
            try {
                s.close();
            }
            catch (e) {
            }
        });
    }

    if (!socket) {
        connectionType = 'http';
        socket = new eio.Socket(explicitBaseUrl, eioOptions);
        await once(socket, 'open');
    }

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
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
        } = scrypted;
        console.log('api attached', Date.now() - start);

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

        const [userStorage, version, rtcConnectionManagement] = await Promise.all([
            rpcPeer.getParam('userStorage'),
            (async () => {
                const info = await systemManager.getComponent('info');
                let version = 'unknown';
                try {
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

        const ret: ScryptedClientStatic = {
            pluginRemoteAPI: undefined,
            connectionType,
            version,
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            userStorage,
            disconnect() {
                rpcPeer.kill('disconnect requested');
            },
            pluginHostAPI: undefined,
            rtcConnectionManagement,
            browserSignalingSession,
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
