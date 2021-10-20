export class Info {
    getVersion() {
        return require('../../package.json').version;
    }
}
