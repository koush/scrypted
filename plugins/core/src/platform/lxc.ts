import fs from 'fs';
import child_process from 'child_process';
import { once } from 'events';
import sdk from '@scrypted/sdk';

export const SCRYPTED_INSTALL_ENVIRONMENT_LXC = 'lxc';

export async function checkLxcDependencies() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT !== SCRYPTED_INSTALL_ENVIRONMENT_LXC)
        return;

    let needRestart = false;
    if (!process.version.startsWith('v20.')) {
        const cp = child_process.spawn('sh', ['-c', 'apt update -y && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs']);
        const [exitCode] = await once(cp, 'exit');
        if (exitCode !== 0)
            sdk.log.a('Failed to install Node.js 20.x.');
        else
            needRestart = true;
    }

    if (!fs.existsSync('/var/run/avahi-daemon/socket')) {
        const cp = child_process.spawn('sh', ['-c', 'apt update -y && apt install -y avahi-daemon && apt upgrade -y']);
        const [exitCode] = await once(cp, 'exit');
        if (exitCode !== 0)
            sdk.log.a('Failed to install avahi-daemon.');
        else
            needRestart = true;
    }

    const scryptedService = fs.readFileSync('lxc/scrypted.service').toString();
    const installedScryptedService = fs.readFileSync('/etc/systemd/system/scrypted.service').toString();

    if (installedScryptedService !== scryptedService) {
        fs.writeFileSync('/etc/systemd/system/scrypted.service', scryptedService);
        needRestart = true;

        const cp = child_process.spawn('systemctl', ['daemon-reload']);
        const [exitCode] = await once(cp, 'exit');
        if (exitCode !== 0)
            sdk.log.a('Failed to daemon-reload systemd.');
    }

    if (needRestart)
        sdk.log.a('A system update is pending. Please restart Scrypted to apply changes.');
}
