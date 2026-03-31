#! /usr/bin/env node
import ncp from 'ncp';
import path from 'path';

ncp(path.join(__dirname, '../../tsconfig.plugin.json'), 'tsconfig.json', (err) => {
    if (err) console.error(err);
});
