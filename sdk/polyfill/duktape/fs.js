import {resolve} from 'path';

var files = {};

function readFileSync(file) {
    file = resolve(file);
    var data = files[file];
    if (data === undefined) {
        throw new Error("file not found. make sure it is packed using:\nfs.registerFile('/path/to/file', require('raw-loader!/path/to/file'))")
    }
    return data;
}

function registerFile(file, data) {
    files[file] = data;
}

export {
    readFileSync,
    registerFile,
}