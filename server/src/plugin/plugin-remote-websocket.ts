interface WebSocketEvent {
    type: string;
    reason?: string;
    message?: string;
    data?: string|ArrayBufferLike;
    source?: any;
}

interface WebSocketEventListener {
    (evt: WebSocketEvent): void;
}

// @ts-ignore
class WebSocketEventTarget {
    events: { [type: string]: WebSocketEventListener[]} = {};

    dispatchEvent(event: WebSocketEvent) {
        const list = this.events[event.type];
        if (!list) {
            return;
        }
        for (const l of list) {
            l(event);
        }
    }
    addEventListener(type: string, f: WebSocketEventListener) {
        let list = this.events[type];
        if (!list) {
            list = this.events[type] = [];
        }
        list.push(f);
    }
    removeEventListener(type: string, f: WebSocketEventListener) {
        const list = this.events[type];
        if (!list) {
            return;
        }
        const index = list.indexOf(f);
        if (index > -1) {
            list.splice(index, 1);
        }
    }
}

function defineEventAttribute(p: any, type: string) {
    Object.defineProperty(p, 'on' + type, {
        get: function () {
            throw new Error(`${type} is write only`);
        },
        set: function (f) {
            this.events[type] = [f];
        }
    });
}

interface WebSocketEndCallback {
    (): void;
}

interface WebSocketErrorCallback {
    (e: Error): void;
}

interface WebSocketDataCallback {
    (data: string | ArrayBufferLike): void;
}

interface WebSocketSend {
    (message: string|ArrayBufferLike): void;
}

interface WebSocketConnectCallback {
    (e: Error, ws: any, send: WebSocketSend): void;
}

interface WebSocketConnect {
    (url: string, protocols: string[],
        connect: WebSocketConnectCallback,
        end: WebSocketEndCallback,
        error: WebSocketErrorCallback,
        data: WebSocketDataCallback): void;
}

export function createWebSocketClass(__websocketConnect: WebSocketConnect) {

    // @ts-ignore
    class WebSocket extends WebSocketEventTarget {
        _url: string;
        _protocols: string[];
        readyState: number;
        send: (message: string|ArrayBufferLike) => void;
        _ws: any;

        constructor(url: string, protocols?: string[]) {
            super();
            this._url = url;
            this._protocols = protocols;
            this.readyState = 0;

            __websocketConnect(url, protocols, (e, ws, send) => {
                // connect
                if (e != null) {
                    this.dispatchEvent({
                        type: 'error',
                        message: e.toString(),
                    });
                    return;
                }

                this._ws = ws;
                this.send = send;
                this.readyState = 1;
                this.dispatchEvent({
                    type: 'open',
                });
            }, () => {
                // end
                this.readyState = 3;
                this.dispatchEvent({
                    type: 'close',
                    reason: 'closed',
                });
            }, (e: Error) => {
                // error
                this.readyState = 3;
                this.dispatchEvent({
                    type: 'error',
                    message: e.toString(),
                });
            }, (data: string | ArrayBufferLike) => {
                // data
                this.dispatchEvent({
                    type: 'message',
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

        close() {
            this._ws.close();
        }
    }

    defineEventAttribute(WebSocket.prototype, "close");
    defineEventAttribute(WebSocket.prototype, "error");
    defineEventAttribute(WebSocket.prototype, "message");
    defineEventAttribute(WebSocket.prototype, "open");

    return WebSocket;
}
