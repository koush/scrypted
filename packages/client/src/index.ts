import { ScryptedStatic } from "@scrypted/types";
import axios, { AxiosRequestConfig } from 'axios';
import * as eio from 'engine.io-client';
import { SocketOptions } from 'engine.io-client';
import { timeoutFunction, timeoutPromise } from "../../../common/src/promise-utils";
import { BrowserSignalingSession, waitPeerConnectionIceConnected, waitPeerIceConnectionClosed } from "../../../common/src/rtc-signaling";
import { DataChannelDebouncer } from "../../../plugins/webrtc/src/datachannel-debouncer";
import type { IOSocket } from '../../../server/src/io';
import { SidebandBufferSerializer } from '../../../server/src/plugin/buffer-serializer';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
import { createRpcDuplexSerializer } from '../../../server/src/rpc-serializer';
export * from "@scrypted/types";

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

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
    onClose?: Function;
    userStorage: Storage,
    version: string;
}

export interface ScryptedConnectionOptions {
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
}

export interface ScryptedClientOptions extends Partial<ScryptedLoginOptions> {
    pluginId: string;
    clientName?: string;
}

export async function loginScryptedClient(options: ScryptedLoginOptions) {
    let { baseUrl, username, password, change_password } = options;
    const url = `${baseUrl || ''}/login`;
    const response = await axios.post(url, {
        username,
        password,
        change_password,
    }, {
        ...options.axiosConfig,
    });

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    const addresses = response.data.addresses as string[] || [];
    const scryptedCloud = response.headers['x-scrypted-cloud'] === 'true';

    return {
        cookie: response.headers["set-cookie"]?.[0],
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
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
        addresses: response.data.addresses as string[],
        scryptedCloud,
    };
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    let { baseUrl, pluginId, clientName, username, password } = options;

    const extraHeaders: { [header: string]: string } = {};
    let addresses: string[];
    let trySideband: boolean;

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);
        if (loginResult.cookie)
            extraHeaders['Cookie'] = loginResult.cookie;
        addresses = loginResult.addresses;
        trySideband = loginResult.scryptedCloud;
    }
    else {
        const loginCheck = await checkScryptedClientLogin({
            baseUrl,
        });
        addresses = loginCheck.addresses;
        trySideband = loginCheck.scryptedCloud;
    }

    let socket: IOClientSocket;
    const endpointPath = `/endpoint/${pluginId}`;
    const eioOptions: Partial<SocketOptions> = {
        path: `${endpointPath}/engine.io/api`,
        extraHeaders,
        rejectUnauthorized: false,
    };

    const start = Date.now();

    const explicitBaseUrl = baseUrl || `${window.location.protocol}//${window.location.host}`;

    let rpcPeer: RpcPeer;
    if (trySideband) {
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

            if (global.RTCPeerConnection) {
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
                ready.send(JSON.stringify({
                    pluginId,
                }));
                const session = new BrowserSignalingSession();
                const pcPromise = session.pcDeferred.promise;

                const upgradingPeer = new RpcPeer(clientName || 'webrtc-upgrade', "api", (message, reject) => {
                    try {
                        ready.send(JSON.stringify(message));
                    }
                    catch (e) {
                        reject?.(e);
                    }
                });

                ready.on('message', data => {
                    upgradingPeer.handleMessage(JSON.parse(data.toString()));
                });

                const readyClose = new Promise<RpcPeer>((resolve, reject) => {
                    ready.on('close', () => reject(new Error('closed')))
                })

                upgradingPeer.params['session'] = session;

                rpcPeer = await Promise.race([readyClose, timeoutFunction(2000, async (isTimedOut) => {
                    const pc = await pcPromise;

                    await waitPeerConnectionIceConnected(pc);

                    const dc = await session.dcDeferred.promise;
                    console.log('got dc', dc);

                    const debouncer = new DataChannelDebouncer(dc);
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

                            process.nextTick(() => {
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
                        console.log('peer connection established too late. closing.');
                        ready.close();
                    }
                    else {
                        console.log('peer connection api connected', Date.now() - start);
                    }
                    return ret;
                })]);
            }

            socket = ready;
            sockets = sockets.filter(s => s !== socket);
        }
        catch (e) {
            // console.error('local check failed', e);
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
        socket = new eio.Socket(explicitBaseUrl, eioOptions);
        await once(socket, 'open');
    }

    try {
        if (!rpcPeer) {
            rpcPeer = new RpcPeer(clientName || 'engine.io-client', "api", message => socket.send(JSON.stringify(message)));
            let pendingSerializationContext: any = {};
            socket.on('message', data => {
                if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
                    pendingSerializationContext = pendingSerializationContext || {
                        buffers: [],
                    };
                    const buffers: Buffer[] = pendingSerializationContext.buffers;
                    buffers.push(Buffer.from(data));
                    return;
                }
                const messageSerializationContext = pendingSerializationContext;
                pendingSerializationContext = undefined;
                rpcPeer.handleMessage(JSON.parse(data as string), messageSerializationContext);
            });
            rpcPeer.addSerializer(Buffer, 'Buffer', new SidebandBufferSerializer());
        }

        const scrypted = await attachPluginRemote(rpcPeer, undefined);
        const {
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
        } = scrypted;

        const userStorage = await rpcPeer.getParam('userStorage');

        const info = await systemManager.getComponent('info');
        let version = 'unknown';
        try {
            version = await info.getVersion();
        }
        catch (e) {
        }

        const ret: ScryptedClientStatic = {
            version,
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            userStorage,
            disconnect() {
                socket.close();
            },
            pluginHostAPI: undefined,
        }

        socket.on('close', () => ret.onClose?.());

        return ret;
    }
    catch (e) {
        socket.close();
        throw e;
    }
}
