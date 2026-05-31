#! /usr/bin/env node
import child_process from 'child_process';
import util from 'util';
import fs from 'fs';

const shas = child_process.execSync('git log --format=format:%H .');
const exec = util.promisify(child_process.exec);

const versions = new Map<string, string>();

interface VersionInfo {
    packageJson?: { version?: string };
    commit?: string;
}

const promises = shas.toString().split('\n').map(sha => sha.trim()).map(async sha => {
    try {
        const result = await exec(`git show ${sha}:./package.json`);
        const packageJson = JSON.parse(result.stdout);
        const commit = await exec(`git rev-list --format=%B --max-count=1 ${sha}`);
        return {
            packageJson,
            commit: commit.stdout,
        };
    }
    catch (e) {
        console.error(e);
    }
});

Promise.all(promises).then(pairs => {
    const validPairs = (pairs as (VersionInfo | undefined)[]).filter((pair): pair is VersionInfo => !!pair?.packageJson?.version);
    for (const valid of validPairs) {
        const { packageJson, commit } = valid;
        const version = packageJson!.version!;
        if (!version) continue;
        
        let log = versions.get(version) || '';
        const firstLine = commit?.split('\n')[1] || '';

        if ([version, 'wip', 'logging', 'wiop', 'publish'].includes(firstLine))
            continue;

        if (!log) {
            log = '';
            versions.set(version, log);
        }

        log += `${firstLine}\n`;
        versions.set(version, log);
    }

    let changeLog = '<details>\n<summary>Changelog</summary>\n\n';
    for (const [version, log] of versions.entries()) {
        changeLog += `### ${version}\n\n${log}\n\n`;
    }

    changeLog += '</details>\n';

    fs.writeFileSync('CHANGELOG.md', changeLog);
});
