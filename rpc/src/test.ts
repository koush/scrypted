import child_process from 'child_process';
import net from 'net';
import { RpcPeer } from '../../server/src/rpc';
import readline from 'readline';

const cp = child_process.spawn('ls', ['-l', '/dev/fd'], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
});

cp.stdout.on('data', data => console.log(data.toString()));



const server = net.createServer(async (connection) => {
    let ended = false;
    connection.on('end', () => ended = true);
    connection.on('error', () => ended = true);
    connection.on('close', () => ended = true);
    const peer = new RpcPeer((message, reject) => {
        if (ended) {
            return reject?.(new Error('connection ended'));
        }
        connection.write(JSON.stringify(message) + '\n', e => e && reject?.(e));
    });
    (console as any).__proxy_required = true;
    peer.params.console = console;

    const readInterface = readline.createInterface({
        input: connection,
        terminal: false,
    });
    readInterface.on('line', line => {
        peer.handleMessage(JSON.parse(line));
    });

    const print = await peer.getParam('print');
    await print('hello!!');
});

server.listen(3033);
