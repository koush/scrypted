import sdk from '@scrypted/sdk';

export const SCRYPTED_INSTALL_ENVIRONMENT_LXC = 'lxc';

export async function checkLegacyLxc() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT !== SCRYPTED_INSTALL_ENVIRONMENT_LXC)
        return;

    sdk.log.a('This system is currently running the legacy LXC installation method and must be migrated to the new LXC manually: https://docs.scrypted.app/installation.html#proxmox-ve-container-reset');
}
