interface WebSocketEvent {
    type: string;
    reason?: string;
    message?: string;
    data?: string | ArrayBufferLike;
    source?: any;
}

interface WebSocketEventListener {
    (evt: WebSocketEvent): void;
}

// @ts-ignore
class WebSocketEventTarget {
    events: { [type: string]: WebSocketEventListener[] } = {};

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

export interface WebSocketConnectCallbacks {
    connect(e: Error, ws: WebSocketMethods): void;
    end(): void;
    error(e: Error): void;
    data(data: string | ArrayBufferLike): void;
}

export interface WebSocketConnect {
    (url: string, protocols: string[], callbacks: WebSocketConnectCallbacks): void;
}

export interface WebSocketMethods {
    send(message: string | ArrayBufferLike): void;
    close(message: string): void;
}

export function createWebSocketClass(__websocketConnect: WebSocketConnect) {

    // @ts-ignore
    class WebSocket extends WebSocketEventTarget {
        _url: string;
        _protocols: string[];
        readyState: number;
        _ws: WebSocketMethods;

        constructor(url: string, protocols?: string[]) {
            super();
            this._url = url;
            this._protocols = protocols;
            this.readyState = 0;

            __websocketConnect(url, protocols, {
                connect: (e, ws) => {
                    // connect
                    if (e != null) {
                        this.dispatchEvent({
                            type: 'error',
                            message: e.toString(),
                        });
                        return;
                    }

                    this._ws = ws;
                    this.readyState = 1;
                    this.dispatchEvent({
                        type: 'open',
                    });
                },
                end: () => {
                    // end
                    this.readyState = 3;
                    this.dispatchEvent({
                        type: 'close',
                        reason: 'closed',
                    });
                },
                error: (e: Error) => {
                    // error
                    this.readyState = 3;
                    this.dispatchEvent({
                        type: 'error',
                        message: e.toString(),
                    });
                },
                data: (data: string | ArrayBufferLike) => {
                    // data
                    this.dispatchEvent({
                        type: 'message',
                        data: data,
                        source: this,
                    });
                }
            })
        }

        send(message: string | ArrayBufferLike) {
            this._ws.send(message);
        }

        get url() {
            return this._url;
        }

        get extensions() {
            return "";
        }

        close(reason: string) {
            this._ws.close(reason);
        }
    }

    defineEventAttribute(WebSocket.prototype, "close");
    defineEventAttribute(WebSocket.prototype, "error");
    defineEventAttribute(WebSocket.prototype, "message");
    defineEventAttribute(WebSocket.prototype, "open");

    return WebSocket;
}
