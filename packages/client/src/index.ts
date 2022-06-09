import axios, { AxiosRequestConfig } from 'axios';
import * as eio from 'engine.io-client';
import { SocketOptions } from 'engine.io-client';
import { once } from "events";
import https from 'https';
import { ScryptedStatic } from "../../../sdk/types/index";
import type { IOSocket } from '../../../server/src/io';
import { SidebandBufferSerializer } from '../../../server/src/plugin/buffer-serializer';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
export * from "../../../sdk/types/index";
import ip from 'ip';
import { timeoutPromise } from "@scrypted/common/src/promise-utils";

type IOClientSocket = eio.Socket & IOSocket;

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
    onClose?: Function;
    userStorage: Storage,
    version: string;
}

export interface ScryptedConnectionOptions {
    baseUrl: string;
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

const axiosConfig: AxiosRequestConfig = {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    })
}

export async function loginScryptedClient(options: ScryptedLoginOptions) {
    let { baseUrl, username, password, change_password } = options;
    const url = `${baseUrl || ''}/login`;
    const response = await axios.post(url, {
        username,
        password,
        change_password,
    }, {
        ...axiosConfig,
    });

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    const addresses = response.data.addresses as string[] || [];

    return {
        cookie: response.headers["set-cookie"]?.[0],
        error: response.data.error as string,
        token: response.data.token as string,
        addresses,
    };
}

export async function checkScryptedClientLogin(options?: ScryptedConnectionOptions) {
    let { baseUrl } = options || {};
    const url = `${baseUrl || ''}/login`;
    const response = await axios.get(url, {
        ...axiosConfig,
    });
    return {
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
        addresses: response.data.addresses as string[],
    };
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    let { baseUrl, pluginId, clientName, username, password } = options;

    const extraHeaders: { [header: string]: string } = {};
    let addresses: string[];

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);;
        extraHeaders['Cookie'] = loginResult.cookie;
        addresses = loginResult.addresses;
    }
    else {
        const loginCheck = await checkScryptedClientLogin({
            baseUrl,
        });
        addresses = loginCheck.addresses;
    }

    let socket: IOClientSocket;
    const endpointPath = `/endpoint/${pluginId}`;
    const eioOptions: Partial<SocketOptions> = {
        transports: ["websocket", "polling"],
        path: `${endpointPath}/engine.io/api`,
        extraHeaders,
        rejectUnauthorized: false,
    };

    const explicitBaseUrl = baseUrl || `${window.location.protocol}//${window.location.host}`;
    if (window.location.hostname !== 'localhost' && !ip.isPrivate(window.location.hostname) && addresses && !addresses.includes(explicitBaseUrl)) {
        const publicEioOptions: Partial<SocketOptions> = {
            transports: ["websocket", "polling"],
            path: `${endpointPath}/public/engine.io/api`,
            extraHeaders,
            rejectUnauthorized: false,
        };

        let sockets: IOClientSocket[] = [];
        type EIOResult = { ready: IOClientSocket, id: string, address: string };
        const promises: Promise<EIOResult>[] = [];

        // console.log('checking local addresses', addresses);
        try {
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
            const any = Promise.any(promises);
            const { ready, id, address } = await timeoutPromise(1000, any);
            // console.log('using local address', address);

            const url = `${eioOptions.path}/activate`;
            await axios.post(url, {
                id,
            }, {
                ...axiosConfig,
            });

            socket = ready;
            socket.send('/api/start');
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
        const rootLocation = explicitBaseUrl;
        socket = new eio.Socket(rootLocation, eioOptions);
        await once(socket, 'open');
    }

    try {
        const rpcPeer = new RpcPeer(clientName || 'engine.io-client', "core", message => socket.send(JSON.stringify(message)));
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
            }
        }

        socket.on('close', () => ret.onClose?.());

        return ret;
    }
    catch (e) {
        socket.close();
        throw e;
    }
}
