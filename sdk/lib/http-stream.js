import { inherits } from 'util';
import { ReadableSocket } from './readablestream-socket';

function HttpResponse() {
    ReadableSocket.call(this, {});
}
inherits(HttpResponse, ReadableSocket);

HttpResponse.prototype._read = function (len) {
    this._reading = len;
    setImmediate(function() {
        this._data();
    }.bind(this))
}

function HttpRequest(method, url) {
    this.__request = __createHttpRequest(method, url);
}

HttpRequest.prototype.setRequestHeader = function (key, val) {
    this.__request.setHeader(key, val);
}

function HttpClient() {
}

HttpClient.prototype.execute = function (request) {
    return new Promise((resolve, reject) => {

        var response = new HttpResponse();
        response._socket = new ReadableSocket(response);
        __executeHttpStreamRequest(request.__request,
            function (e, socket, code, message, headers) {
                if (e != null) {
                    var err = new Error(e.getMessage());
                    reject(err);
                    return;
                }
                socket.pause();
                response._socket = socket;
                response.code = code;
                response.message = message;
                response.headers = {};
                var parts = headers.split('\r\n');
                headers = response.headers;
                for (var part of parts) {
                    var splits = part.split(':', 2);
                    var name = decodeURIComponent(splits[0]).toLowerCase().trim();
                    if (!name.length) {
                        continue;
                    }
                    var value = '';
                    if (splits.length > 1) {
                        value = decodeURIComponent(splits[1]).trim();
                    }
                    var existing = headers[name];
                    if (!existing) {
                        headers[name] = value;
                    }
                    else if (existing instanceof Array) {
                        headers.push(value);
                    }
                    else {
                        headers[name] = [existing, value];
                    }
                }
                response.headers = headers;
                resolve(response);
            }.bind(this),
            response._close.bind(response),
            response._error.bind(response),
            response._data.bind(response));
    });
}


exports.HttpClient = HttpClient;
exports.HttpRequest = HttpRequest;