#! /usr/bin/env node
const child_process = require('child_process');
const util = require('util');
const fs = require('fs');

const shas = child_process.execSync('git log --format=format:%H .');
const exec = util.promisify(child_process.exec);

const versions = new Map();

const promises = shas.toString().split('\n').map(sha => sha.trim()).map(async sha => {
    // console.log(sha);
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
    // console.log(pairs);
    const validPairs = pairs.filter(pair => pair?.packageJson?.version);
    for (const valid of validPairs) {
        const { packageJson, commit } = valid;
        const { version } = packageJson;
        let log = versions.get(version) || '';
        const firstLine = commit.split('\n')[1];

        // filter out some junk commits
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
