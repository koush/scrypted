import { ScryptedStatic } from "@scrypted/types";
export * from "@scrypted/types";
import { SocketOptions } from 'engine.io-client';
import eio from 'engine.io-client';
import { attachPluginRemote } from  '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';
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
    password?: string;
}

const axiosConfig: AxiosRequestConfig = {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
}

/**
 * 
 * @param baseUrl The base url of the webserver, or undefined to use current url (browser only).
 * @param pluginId The plugin id to connect to.
 * @param clientName Any string representing your web client, used for error logging.
 * @returns 
 */
export async function connectScryptedClient(options: ScryptedClientOptions): Promise<ScryptedClientStatic> {
    let { baseUrl, pluginId, clientName, username, password } = options;
    const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
    const endpointPath = `/endpoint/${pluginId}`;

    const extraHeaders: { [header: string]: string } = {};

    if (username && password) {
        const url = `${baseUrl}/login`;
        const response = await axios.post(url, {
            username,
            password,
        }, axiosConfig);

        extraHeaders['Cookie'] = response.headers["set-cookie"][0];
    }

    return new Promise((resolve, reject) => {
        const options: SocketOptions = {
            path: `${endpointPath}/engine.io/api/`,
            extraHeaders,
            rejectUnauthorized: false,
        };
        const socket = eio(rootLocation, options);

        socket.on('error', reject);

        socket.on('open', async function () {
            try {
                const rpcPeer = new RpcPeer(clientName || 'web-sdk', "core", message => socket.send(JSON.stringify(message)));
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
