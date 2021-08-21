class EventTarget {
    events = {};

    dispatchEvent(event) {
        var list = this.events[event.type];
        if (!list) {
            return;
        }
        for (var l of list) {
            l(event);
        }
    }
    addEventListener(type, f) {
        var list = this.events[type];
        if (!list) {
            list = this.events[type] = [];
        }
        list.push(f);
    }
    removeEventListener(type, f) {
        var list = this.events[type];
        if (!list) {
            return;
        }
        var index = list.indexOf(f);
        if (index > -1) {
            list.splice(index, 1);
        }
    }
}

function defineEventAttribute(p, type) {
    Object.defineProperty(p, 'on' + type, {
        get: function () {
            throw new Error(`${type} is write only`);
        },
        set: function (f) {
            this.events[type] = [f];
        }
    });
}

class WebSocket extends EventTarget {
    constructor(url, protocols) {
        super();
        this._url = url;
        this._protocols = protocols;
        this.readyState = 0;

        __websocketConnect(url, protocols, (e, ws, send) => {
            // connect
            if (e != null) {
                this.dispatchEvent({
                    type: 'error',
                    key: Math.random().toString(),
                    message: e.toString(),
                });
                return;
            }

            this._ws = ws;
            this._send = send;
            this.readyState = 1;
            this.dispatchEvent({
                type: 'open',
                key: Math.random().toString(),
            });
        }, e => {
            // end
            this.readyState = 3;
            this.dispatchEvent({
                type: 'close',
                key: Math.random().toString(),
                code: 1000,
                reason: 'closed',
            });
        }, e => {
            // error
            this.readyState = 3;
            this.dispatchEvent({
                type: 'error',
                key: Math.random().toString(),
                message: e.toString(),
            });
        }, data => {
            // data
            this.dispatchEvent({
                type: 'message',
                key: Math.random().toString(),
                data: data,
                source: this,
            });
        });
    }

    get url() {
        return this._url;
    }

    get extensions() {
        return "";
    }

    send(message) {
        this._send(message);
    }

    close() {
        this._ws.close();
    }
}

defineEventAttribute(WebSocket.prototype, "close");
defineEventAttribute(WebSocket.prototype, "error");
defineEventAttribute(WebSocket.prototype, "message");
defineEventAttribute(WebSocket.prototype, "open");

module.exports = WebSocket;
global.WebSocket = WebSocket;
