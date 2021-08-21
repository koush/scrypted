import { inherits } from 'util';
import EventEmitter from 'events';

function Browser(suffix) {
    EventEmitter.call(this);
    this._suffix = suffix;
}
inherits(Browser, EventEmitter)

Browser.prototype.start = function() {
    if (this._cancel) {
        return;
    }

    this._cancel = __mdnsScan(this._suffix, function (result) {
        this.emit('serviceUp', {
            name: result.name,
            addresses: [result.host],
            port: result.port,
            txtRecord: result.attributes,
        })
    }.bind(this));
}

Browser.prototype.stop = function() {
    if (this._cancel) {
        this._cancel.cancel();
        delete this._cancel;
    }
}

function tcp(str) {
    return `_${str}._tcp`;
}

function createBrowser(suffix) {
    return new Browser(suffix);
}

export {
    tcp,
    createBrowser,
}