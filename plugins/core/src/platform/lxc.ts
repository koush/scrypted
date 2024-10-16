import sdk from '@scrypted/sdk';
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import os from 'os';

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

    try {
        const output = await new Promise<string>((r, f) => child_process.exec("sh -c 'apt list --installed | grep level-zero/'", (err, stdout, stderr) => {
            if (err && !stdout && !stderr)
                f(err);
            else
                r(stdout + '\n' + stderr);
        }));

        const cpuModel = os.cpus()[0].model;
        if (cpuModel.includes('Core') && cpuModel.includes('Ultra')) {
            if (
                // apt
                !output.includes('level-zero/')
            ) {
                const cp = child_process.spawn('sh', ['-c', 'curl https://raw.githubusercontent.com/koush/scrypted/main/install/docker/install-intel-npu.sh | bash']);
                const [exitCode] = await once(cp, 'exit');
                if (exitCode !== 0)
                    sdk.log.a('Failed to install intel-driver-compiler-npu.');
                else
                    needRestart = true;
            }
        }
        else {
            // level-zero crashes openvino on older CPU due to illegal instruction.
            // so ensure it is not installed if this is not a core ultra system with npu.
            if (
                // apt
                output.includes('level-zero/')
            ) {
                const cp = child_process.spawn('apt', ['-y', 'remove', 'level-zero']);
                const [exitCode] = await once(cp, 'exit');
                console.log('level-zero removed', exitCode);
                needRestart = true;
            }
        }

    }
    catch (e) {
        sdk.log.a('Failed to verify/install intel-driver-compiler-npu.');
    }

    try {
        // intel opencl icd is broken from their official apt repos on kernel versions 6.8, which ships with ubuntu 24.04 and proxmox 8.2.
        // the intel apt repo has not been updated yet.
        // the current workaround is to install the release manually.
        // https://github.com/intel/compute-runtime/releases/tag/24.13.29138.7
        const output = await new Promise<string>((r, f) => child_process.exec("sh -c 'apt show versions intel-opencl-icd'", (err, stdout, stderr) => {
            if (err && !stdout && !stderr)
                f(err);
            else
                r(stdout + '\n' + stderr);
        }));

        if (
            // apt
            output.includes('Version: 23')
            // was installed via script at some point
            || output.includes('Version: 24.13.29138.7')
            || output.includes('Version: 24.26.30049.6')
            || output.includes('Version: 24.31.30508.7')
            // current script version: 24.35.30872.22
        ) {
            const cp = child_process.spawn('sh', ['-c', 'curl https://raw.githubusercontent.com/koush/scrypted/main/install/docker/install-intel-graphics.sh | bash']);
            const [exitCode] = await once(cp, 'exit');
            if (exitCode !== 0)
                sdk.log.a('Failed to install intel-opencl-icd.');
            else
                needRestart = true;
        }
    }
    catch (e) {
        sdk.log.a('Failed to verify/install intel-opencl-icd version.');
    }

    if (needRestart)
        sdk.log.a('A system update is pending. Please restart Scrypted to apply changes.');
}
