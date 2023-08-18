import { MediaObjectOptions, RTCConnectionManagement, RTCSignalingSession, ScryptedStatic } from "@scrypted/types";
import axios, { AxiosRequestConfig } from 'axios';
import * as eio from 'engine.io-client';
import { SocketOptions } from 'engine.io-client';
import { Deferred } from "../../../common/src/deferred";
import { timeoutPromise } from "../../../common/src/promise-utils";
import { BrowserSignalingSession, waitPeerConnectionIceConnected, waitPeerIceConnectionClosed } from "../../../common/src/rtc-signaling";
import { DataChannelDebouncer } from "../../../plugins/webrtc/src/datachannel-debouncer";
import type { IOSocket } from '../../../server/src/io';
import { MediaObject } from '../../../server/src/plugin/mediaobject';
import type { MediaObjectRemote } from '../../../server/src/plugin/plugin-api';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
import { createRpcDuplexSerializer, createRpcSerializer } from '../../../server/src/rpc-serializer';
import packageJson from '../package.json';
import { isIPAddress } from "./ip";

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
    rpcPeer: RpcPeer,
}

export interface ScryptedConnectionOptions {
    direct?: boolean;
    local?: boolean;
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

function isInstalledApp() {
    return globalThis.navigator?.userAgent.includes('InstalledApp');
}

function isRunningStandalone() {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches || isInstalledApp();
}

export async function logoutScryptedClient(baseUrl?: string) {
    const url = combineBaseUrl(baseUrl, 'logout');
    const response = await axios(url, {
        withCredentials: true,
    });
    return response.data;
}

export function getCurrentBaseUrl() {
    // an endpoint within scrypted will be served at /endpoint/[org/][id]
    // find the endpoint prefix and anything prior to that will be the server base url.
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    let endpointPath = window.location.pathname;
    const parts = endpointPath.split('/');
    const index = parts.findIndex(p => p === 'endpoint');
    if (index === -1) {
        // console.warn('path not recognized, does not contain the segment "endpoint".')
        return undefined;
    }
    const keep = parts.slice(0, index);
    keep.push('');
    url.pathname = keep.join('/');
    return url.toString();
}

export async function loginScryptedClient(options: ScryptedLoginOptions) {
    let { baseUrl, username, password, change_password, maxAge } = options;
    // pwa should stay logged in for a year.
    if (!maxAge && isRunningStandalone())
        maxAge = 365 * 24 * 60 * 60 * 1000;

    const url = combineBaseUrl(baseUrl, 'login');
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
    const cloudAddress = response.headers['x-scrypted-cloud-address'];

    return {
        error: response.data.error as string,
        authorization: response.data.authorization as string,
        queryToken: response.data.queryToken as any,
        token: response.data.token as string,
        addresses,
        scryptedCloud,
        directAddress,
        cloudAddress,
    };
}

export async function checkScryptedClientLogin(options?: ScryptedConnectionOptions) {
    let { baseUrl } = options || {};
    const url = combineBaseUrl(baseUrl, 'login');
    const response = await axios.get(url, {
        withCredentials: true,
        ...options?.axiosConfig,
    });
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';
    const directAddress = response.headers['x-scrypted-direct-address'];
    const cloudAddress = response.headers['x-scrypted-cloud-address'];

    return {
        hostname: response.data.hostname as string,
        redirect: response.data.redirect as string,
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
        error: response.data.error as string,
        authorization: response.data.authorization as string,
        queryToken: response.data.queryToken as any,
        token: response.data.token as string,
        addresses: response.data.addresses as string[],
        scryptedCloud,
        directAddress,
        cloudAddress,
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

export function combineBaseUrl(baseUrl: string, rootPath: string) {
    return baseUrl ? new URL(rootPath, baseUrl).toString() : '/' + rootPath;
}

export async function redirectScryptedLogout(baseUrl?: string) {
    globalThis.location.href = combineBaseUrl(baseUrl, 'logout');
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    const start = Date.now();
    let { baseUrl, pluginId, clientName, username, password } = options;
    let authorization: string;
    let queryToken: any;

    const extraHeaders: { [header: string]: string } = {};
    let localAddresses: string[];
    let scryptedCloud: boolean;
    let directAddress: string;
    let cloudAddress: string;

    console.log('@scrypted/client', packageJson.version);

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);
        if (loginResult.authorization)
            extraHeaders['Authorization'] = loginResult.authorization;
        localAddresses = loginResult.addresses;
        scryptedCloud = loginResult.scryptedCloud;
        directAddress = loginResult.directAddress;
        cloudAddress = loginResult.cloudAddress;
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
        localAddresses = loginCheck.addresses;
        scryptedCloud = loginCheck.scryptedCloud;
        directAddress = loginCheck.directAddress;
        cloudAddress = loginCheck.cloudAddress;
        username = loginCheck.username;
        authorization = loginCheck.authorization;
        queryToken = loginCheck.queryToken;
        console.log('login checked', Date.now() - start, loginCheck);
    }

    let socket: IOClientSocket;
    const eioPath = `endpoint/${pluginId}/engine.io/api`;
    const eioEndpoint = baseUrl ? new URL(eioPath, baseUrl).pathname : '/' + eioPath;
    const eioOptions: Partial<SocketOptions> = {
        path: eioEndpoint,
        withCredentials: true,
        extraHeaders,
        rejectUnauthorized: false,
        transports: options?.transports,
    };

    const explicitBaseUrl = baseUrl || `${globalThis.location.protocol}//${globalThis.location.host}`;

    // underlying webrtc rpc transport may queue up messages before its ready to be to be handled.
    // watch for this flush.
    const flush = new Deferred<void>();

    // Chrome will complain about websites making xhr requests to self signed https sites, even
    // if the cert has been accepted. Other browsers seem fine.
    // So the default is not to connect to IP addresses on Chrome, but do so on other browsers.
    const isChrome = globalThis.navigator?.userAgent.includes('Chrome');
    const isNotChromeOrIsInstalledApp = !isChrome || isInstalledApp();

    const addresses: string[] = [];
    const localAddressDefault = isNotChromeOrIsInstalledApp;
    if (((scryptedCloud && options.local === undefined && localAddressDefault) || options.local) && localAddresses) {
        addresses.push(...localAddresses);
    }

    const directAddressDefault = directAddress && (isNotChromeOrIsInstalledApp || !isIPAddress(directAddress));
    if (((scryptedCloud && options.direct === undefined && directAddressDefault) || options.direct) && directAddress) {
        addresses.push(directAddress);
    }

    if (((scryptedCloud && options.direct === undefined) || options.direct) && cloudAddress) {
        addresses.push(cloudAddress);
    }

    const tryAddresses = !!addresses.length;
    const webrtcLastFailedKey = 'webrtcLastFailed';
    const canUseWebrtc = !!globalThis.RTCPeerConnection;
    let tryWebrtc = canUseWebrtc && options.webrtc;
    // try webrtc by default on scrypted cloud.
    // but webrtc takes a while to fail, so backoff if it fails to prevent continual slow starts.
    if (scryptedCloud && canUseWebrtc && globalThis.localStorage && options.webrtc === undefined) {
        tryWebrtc = true;
        const webrtcLastFailed = parseFloat(localStorage.getItem(webrtcLastFailedKey));
        // if webrtc has failed in the past day, dont attempt to use it.
        const now = Date.now();
        if (webrtcLastFailed < now && webrtcLastFailed > now - 1 * 24 * 60 * 60 * 1000) {
            tryWebrtc = false;
            console.warn('WebRTC API connection recently failed. Skipping.')
        }
    }

    console.log({
        tryLocalAddressess: tryAddresses,
        tryWebrtc,
    });

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
    type EIOResult = { ready: IOClientSocket, connectionType: ScryptedClientConnectionType, address?: string, rpcPeer?: RpcPeer };
    const promises: Promise<EIOResult>[] = [];

    if (tryAddresses) {
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
        const check = new eio.Socket(explicitBaseUrl, webrtcEioOptions) as IOClientSocket;
        sockets.push(check);
        promises.push((async () => {
            await once(check, 'open');

            const connectionManagementId = `connectionManagement-${Math.random()}`;
            const updateSessionId = `updateSessionId-${Math.random()}`;
            check.send(JSON.stringify({
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
                sendMessageBuffer: buffer => check.send(buffer),
                sendMessageFinish: message => check.send(JSON.stringify(message)),
            });
            const upgradingPeer = new RpcPeer(clientName || 'webrtc-upgrade', "api", (message, reject, serializationContext) => {
                try {
                    serializer.sendMessage(message, reject, serializationContext);
                }
                catch (e) {
                    reject?.(e);
                }
            });

            check.on('message', data => {
                if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
                    serializer.onMessageBuffer(Buffer.from(data));
                }
                else {
                    serializer.onMessageFinish(JSON.parse(data as string));
                }
            });
            serializer.setupRpcPeer(upgradingPeer);

            const readyClose = new Promise<RpcPeer>((resolve, reject) => {
                check.on('close', () => reject(new Error('closed')))
            })

            upgradingPeer.params['session'] = session;

            const pc = await pcPromise;
            console.log('peer connection received');

            await waitPeerConnectionIceConnected(pc);
            console.log('waiting for data channel');

            const dc = await dcDeferred.promise;
            console.log('datachannel received', Date.now() - start);

            const debouncer = new DataChannelDebouncer(dc, e => {
                console.error('datachannel send error', e);
                rpcPeer.kill('datachannel send error');
            });
            const dcSerializer = createRpcDuplexSerializer({
                write: (data) => debouncer.send(data),
            });

            while (droppedMessages.length) {
                const message = droppedMessages.shift();
                dc.dispatchEvent(message);
            }

            const rpcPeer = new RpcPeer('webrtc-client', "api", (message, reject, serializationContext) => {
                try {
                    dcSerializer.sendMessage(message, reject, serializationContext);
                }
                catch (e) {
                    reject?.(e);
                    pc.close();
                }
            });
            dcSerializer.setupRpcPeer(rpcPeer);

            rpcPeer.params['connectionManagementId'] = connectionManagementId;
            rpcPeer.params['updateSessionId'] = updateSessionId;
            rpcPeer.params['browserSignalingSession'] = session;

            waitPeerIceConnectionClosed(pc).then(() => check.close());
            check.on('close', () => {
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
                                dcSerializer.onData(Buffer.from(buffer));
                            }
                            buffers = undefined;
                        }
                        dc.onmessage = message => dcSerializer.onData(Buffer.from(message.data));
                    });
                };
            });

            return {
                ready: check,
                connectionType: 'webrtc',
                rpcPeer,
            };
        })());
    }

    const p2pPromises = [...promises];

    promises.push((async () => {
        const waitDuration = tryWebrtc ? 10000 : (tryAddresses ? 1000 : 0);
        console.log('waiting', waitDuration);
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
    let { ready, connectionType, address, rpcPeer } = await any;

    if (tryWebrtc && connectionType !== 'webrtc')
        localStorage.setItem(webrtcLastFailedKey, Date.now().toString());

    console.log('connected', connectionType, address)

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

        mediaManager.createMediaObject = async<T extends MediaObjectOptions>(data: any, mimeType: string, options: T) => {
            return new MediaObject(mimeType, data, options) as any;
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
            rpcPeer,
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
