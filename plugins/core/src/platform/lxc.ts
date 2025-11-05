import fs, { writeFileSync } from 'fs';
import sdk from '@scrypted/sdk';
import yaml from 'yaml';
import { readFileAsString } from '@scrypted/common/src/eval/scrypted-eval';

export const SCRYPTED_INSTALL_ENVIRONMENT_LXC = 'lxc';
export const SCRYPTED_INSTALL_ENVIRONMENT_LXC_DOCKER = 'lxc-docker';

export async function checkLegacyLxc() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT !== SCRYPTED_INSTALL_ENVIRONMENT_LXC)
        return;

    sdk.log.a('This system is currently running the legacy LXC installation method and must be migrated to the new LXC manually: https://docs.scrypted.app/install/proxmox-ve.html#proxmox-ve-container-reset');
}

const DOCKER_COMPOSE_SH_PATH = '/root/.scrypted/docker-compose.sh';
const LXC_DOCKER_COMPOSE_SH_PATH = 'lxc/docker-compose.sh';

export async function checkLxc() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT !== SCRYPTED_INSTALL_ENVIRONMENT_LXC_DOCKER)
        return;

    await checkLxcCompose();
    await checkLxcScript();
}

async function checkLxcCompose() {
    // the lxc-docker used watchtower for automatic updates but watchtower started crashing in the lxc environment
    // after a docker update.
    // watchtower was removed from the lxc as a result.
    // however existing installations may still have watchtower in their docker-compose.yml and need it removed.
    const dockerCompose = yaml.parseDocument(readFileAsString('/root/.scrypted/docker-compose.yml'));
    // @ts-ignore
    const watchtower = dockerCompose.contents.get('services').get('watchtower');
    if (watchtower.get('profiles'))
        return;
    watchtower.set('profiles', ['disabled']);
    writeFileSync('/root/.scrypted/docker-compose.yml', yaml.stringify(dockerCompose));
}

async function checkLxcScript() {
    const foundDockerComposeSh = await fs.promises.readFile(DOCKER_COMPOSE_SH_PATH, 'utf8');
    const dockerComposeSh = await fs.promises.readFile(LXC_DOCKER_COMPOSE_SH_PATH, 'utf8');

    if (foundDockerComposeSh === dockerComposeSh) {
        // check if the file is executable
        const stats = await fs.promises.stat(DOCKER_COMPOSE_SH_PATH);
        if (stats.mode & 0o111)
            return;
        await fs.promises.chmod(DOCKER_COMPOSE_SH_PATH, 0o755);
        return;
    }

    // console.warn('lxc needs updating', sdk.clusterManager.getClusterWorkerId());
    // console.warn(foundDockerComposeSh);
    await fs.promises.copyFile(LXC_DOCKER_COMPOSE_SH_PATH, DOCKER_COMPOSE_SH_PATH);
    await fs.promises.chmod(DOCKER_COMPOSE_SH_PATH, 0o755);
}