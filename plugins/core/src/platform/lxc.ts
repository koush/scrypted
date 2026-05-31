import { Deferred } from '@scrypted/common/src/deferred';
import { readFileAsString } from '@scrypted/common/src/eval/scrypted-eval';
import sdk from '@scrypted/sdk';
import fs, { writeFileSync } from 'fs';
import http from 'http';
import yaml from 'yaml';

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


async function dockerRequest(options: http.RequestOptions, body?: string) {
    const deferred = new Deferred<string>();

    const req = http.request({
        socketPath: '/var/run/docker.sock',
        method: options.method,
        path: options.path,
        headers: {
            'Host': 'localhost',
            ...options.headers
        }
    });

    req.on('response', (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            deferred.resolve(data);
        });
    });

    req.on('error', (err) => {
        deferred.reject(err);
    });

    if (body) {
        req.write(body);
    }

    req.end();

    return deferred.promise;
}

async function dockerPullScryptedTag(tag: string) {
    return dockerRequest({
        method: 'POST',
        path: `/v1.41/images/create?fromImage=ghcr.io%2Fkoush%2Fscrypted&tag=${tag}`,
    });
}

async function dockerImageLsScryptedTag(tag: string) {
    // List all images and find the specific one
    const data = await dockerRequest({
        method: 'GET',
        path: '/v1.41/images/json'
    });
    const images = JSON.parse(data);
    // Filter for your specific image
    const targetImage = images.find(image => {
        return image.RepoTags && image.RepoTags.some(t =>
            t === `ghcr.io/koush/scrypted:${tag}`
        );
    });
    if (!targetImage) {
        throw new Error('Image not found');
    }

    return targetImage.Id;
}

async function dockerGetScryptedContainerImageId() {
    // List running containers filtered by name
    const data = await dockerRequest({
        method: 'GET',
        path: '/v1.41/containers/json?filters={"name":["scrypted"],"status":["running"]}'
    });
    const containers = JSON.parse(data);
    if (!containers.length)
        throw new Error('No running container named "scrypted" found');
    const container = containers[0];
    return container.ImageID;
}

export async function checkLxcVersionUpdateNeeded() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT !== SCRYPTED_INSTALL_ENVIRONMENT_LXC_DOCKER)
        return;

    const dockerCompose = yaml.parseDocument(readFileAsString('/root/.scrypted/docker-compose.yml'));
    // @ts-ignore
    const image: string = dockerCompose.contents.get('services').get('scrypted').get('image');
    const label = image.split(':')[1] || 'latest';

    await dockerPullScryptedTag(label);
    const imageId = await dockerImageLsScryptedTag(label);
    const containerImageId = await dockerGetScryptedContainerImageId();
    console.warn('LXC Scrypted latest image ID:', imageId);
    console.warn('LXC Scrypted running image ID:', containerImageId);
    return containerImageId !== imageId;
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