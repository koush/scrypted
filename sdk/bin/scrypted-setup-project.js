#! /usr/bin/env node

const ncp = require('ncp');
const path = require('path');

ncp(path.join(__dirname, '../tsconfig.plugin.json'), 'tsconfig.json');
