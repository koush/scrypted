export class Info {
    getVersion() {
        return process.env.COMMIT_SHA?.substring(0, 8) || require('../../package.json').version;
    }
}
