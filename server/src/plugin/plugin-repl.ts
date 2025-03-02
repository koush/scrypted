import { ScryptedStatic } from '@scrypted/types';
import { once } from 'events';
import repl from 'repl';
import { clusterListenZero } from '../cluster/cluster-setup';

export async function createREPLServer(scrypted: ScryptedStatic, params: any, plugin: any): Promise<number> {
    const { deviceManager, systemManager } = scrypted;
    const { server, port } = await clusterListenZero(async (socket) => {
        let [filter] = await once(socket, 'data');
        filter = filter.toString().trim();
        if (filter === 'undefined')
            filter = undefined;

        const chain: string[] = [];
        const nativeIds: Map<string, any> = (deviceManager as any).nativeIds;
        const reversed = new Map<string, string>();
        for (const nativeId of nativeIds.keys()) {
            reversed.set(nativeIds.get(nativeId).id, nativeId);
        }

        while (filter) {
            const { id } = nativeIds.get(filter);
            const d = await systemManager.getDeviceById(id);
            chain.push(filter);
            filter = reversed.get(d.providerId);
        }

        chain.reverse();
        let device = plugin;
        for (const c of chain) {
            device = await device.getDevice(c);
        }

        const realDevice = systemManager.getDeviceById(device.id);

        const ctx = Object.assign(params, {
            device,
            realDevice,
            sdk: scrypted,
        });
        delete ctx.console;
        delete ctx.window;
        delete ctx.WebSocket;
        delete ctx.pluginHostAPI;
        delete ctx.log;
        delete ctx.pluginRuntimeAPI;

        const replFilter = new Set<string>(['require', 'localStorage', 'exports', '__filename', 'log'])
        const replVariables = Object.keys(ctx).filter(key => !replFilter.has(key));

        const welcome = `JavaScript REPL variables:\n${replVariables.map(key => '  ' + key).join('\n')}\n\n`;
        socket.write(welcome);

        const r = repl.start({
            terminal: true,
            input: socket,
            output: socket,
            // writer(this: REPLServer, obj: any) {
            //     const ret = util.inspect(obj, {
            //         colors: true,
            //     });
            //     return ret;//.replaceAll('\n', '\r\n');
            // },
            preview: false,
        });

        Object.assign(r.context, ctx);

        const cleanup = () => {
            r.close();
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        socket.on('end', cleanup);
    });

    return port;
}
