import { ScryptedStatic } from "../../../sdk/types/index";
export * from "../../../sdk/types/index";
import { SocketOptions } from 'engine.io-client';
import * as eio from 'engine.io-client';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
import { IOSocket } from '../../../server/src/io';
import axios, { AxiosRequestConfig } from 'axios';
import https from 'https';

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
        withCredentials: true,
        ...axiosConfig,
    });

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    return {
        cookie: response.headers["set-cookie"]?.[0],
        error: response.data.error as string,
    };
}

export async function checkScryptedClientLogin(options: ScryptedConnectionOptions) {
    let { baseUrl } = options;
    const url = `${baseUrl || ''}/login`;
    const response = await axios.get(url, {
        withCredentials: true,
        ...axiosConfig,
    });
    return {
        username: response.data.username as string,
        expiration: response.data.expiration as number,
        hasLogin: !!response.data.hasLogin,
    };
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    let { baseUrl, pluginId, clientName, username, password } = options;
    const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
    const endpointPath = `/endpoint/${pluginId}`;

    const extraHeaders: { [header: string]: string } = {};

    if (username && password) {
        const loginResult = await loginScryptedClient(options as ScryptedLoginOptions);;
        extraHeaders['Cookie'] = loginResult.cookie;
    }

    return new Promise((resolve, reject) => {
        const options: Partial<SocketOptions> = {
            path: `${endpointPath}/engine.io/api/`,
            extraHeaders,
            rejectUnauthorized: false,
            withCredentials: true,
        };
        const socket: IOSocket & eio.Socket = new eio.Socket(rootLocation, options);

        socket.on('error', reject);

        socket.on('open', async function () {
            try {
                const rpcPeer = new RpcPeer(clientName || 'engine.io-client', "core", message => socket.send(JSON.stringify(message)));
                socket.on('message', data => rpcPeer.handleMessage(JSON.parse(data as string)));

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

                resolve(ret);
            }
            catch (e) {
                socket.close();
                reject(e);
            }
        });
    });
}
