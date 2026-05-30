module.exports = source => source.replace(
    /JSON\.parse\(\(0, node_fs_1\.readFileSync\)\(require\.resolve\("\.\.\/\.\.\/\.\.\/package\.json"\), "utf-8"\)\)/,
    'require("../../../package.json")'
);
