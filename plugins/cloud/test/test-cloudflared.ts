import { createLocallyManagedTunnel, runLocallyManagedTunnel } from '../src/cloudflared-local-managed';

async function main() {
    const jsonContents = await createLocallyManagedTunnel('test.scrypted.io')
    await runLocallyManagedTunnel(jsonContents, 'http://127.0.0.1:49725', '/tmp/work');
}

main();