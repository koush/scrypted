import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { AuthRequst } from '../src/auth-request';

const quietConsole = { log() {}, debug() {}, info() {}, warn() {}, error() {} } as unknown as Console;

// Every request without credentials gets a digest challenge with a body, like the
// door station does; requests with credentials get 200.
function startChallengeServer(): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        if (!req.headers.authorization) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Digest realm="test", nonce="abc123", qop="auth"',
                'Content-Type': 'text/html',
            });
            res.end('<html>401 Unauthorized</html>'.padEnd(2048, ' '));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"CallStatus":{"status":"idle"}}');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function openConnections(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => server.getConnections((err, n) => err ? reject(err) : resolve(n)));
}

test('digest 401 responses are drained so their sockets do not pile up', async () => {
    const server = await startChallengeServer();
    const { port } = server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 50 });
    try {
        for (let i = 0; i < 8; i++) {
            // a fresh client per request forces the 401 path every time, as the plugin sees it
            const client = new AuthRequst('admin', 'secret', quietConsole);
            const res = await client.request(`http://127.0.0.1:${port}/ISAPI/VideoIntercom/callStatus?format=json`,
                { responseType: 'text', agent });
            assert.equal(res.statusCode, 200);
        }
        await new Promise(r => setTimeout(r, 100));
        const open = await openConnections(server);
        assert.ok(open <= 2, `expected at most 2 open connections, got ${open}`);
    }
    finally {
        agent.destroy();
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
});
