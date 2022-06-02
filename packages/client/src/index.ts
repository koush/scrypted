import { ScryptedStatic } from "../../../sdk/types/index";
export * from "../../../sdk/types/index";
import { SocketOptions } from 'engine.io-client';
import * as eio from 'engine.io-client';
import { attachPluginRemote } from  '../../../server/src/plugin/plugin-remote';
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

export interface ScryptedClientOptions {
    baseUrl?: string;
    pluginId: string;
    clientName?: string;
    username?: string;
    /**
     * The password, or preferably, login token for logging into Scrypted.
     * The login token can be retrieved with "npx scrypted login".
     */
    password?: string;
}

const axiosConfig: AxiosRequestConfig = {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
}

export async function getLoginCookie(baseUrl: string, username: string, password: string) {
    const url = `${baseUrl}/login`;
    const response = await axios.post(url, {
        username,
        password,
    }, axiosConfig);

    if (response.status !== 200)
        throw new Error('status ' + response.status);

    return response.headers["set-cookie"][0];
}

export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    let { baseUrl, pluginId, clientName, username, password } = options;
    const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
    const endpointPath = `/endpoint/${pluginId}`;

    const extraHeaders: { [header: string]: string } = {};

    if (username && password) {
        extraHeaders['Cookie'] = await getLoginCookie(baseUrl, username, password);
    }

    return new Promise((resolve, reject) => {
        const options: Partial<SocketOptions> = {
            path: `${endpointPath}/engine.io/api/`,
            extraHeaders,
            rejectUnauthorized: false,
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
