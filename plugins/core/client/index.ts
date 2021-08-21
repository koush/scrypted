import { ScryptedStatic } from "@scrypted/sdk/types";
import { SocketOptions } from 'engine.io-client';
import eio from 'engine.io-client';
import { attachPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { RpcPeer } from '../../../server/src/rpc';

export interface ScryptedClientStatic extends ScryptedStatic {
    disconnect(): void;
    onClose?: Function;
    userStorage: Storage,
}

export default {
    connect(baseUrl: string): Promise<ScryptedClientStatic> {
        const rootLocation = baseUrl || `${window.location.protocol}//${window.location.host}`;
        const endpointPath = `/endpoint/@scrypted/core`;

        return new Promise((resolve, reject) => {

            const options: SocketOptions = {
                path: `${endpointPath}/engine.io/`,
            };
            const socket = eio(rootLocation, options);

            socket.on('open', async function () {
                try {
                    const rpcPeer = new RpcPeer(message => socket.send(JSON.stringify(message)));
                    socket.on('message', data => rpcPeer.handleMessage(JSON.parse(data as string)));
                    
                    const scrypted = await attachPluginRemote(rpcPeer, undefined);
                    const {
                        systemManager,
                        deviceManager,
                        endpointManager,
                        mediaManager,
                    } = scrypted;

                    const userStorage = await rpcPeer.eval('return userStorage');

                    const ret: ScryptedClientStatic = {
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
}
