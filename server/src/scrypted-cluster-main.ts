import { install as installSourceMapSupport } from 'source-map-support';
import { startClusterClient } from './scrypted-cluster';

installSourceMapSupport({
    environment: 'node',
});

async function start(mainFilename: string) {
    startClusterClient(mainFilename);
}

export default start;
