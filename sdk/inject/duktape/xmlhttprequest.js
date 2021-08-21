
global.XMLHttpRequest = function () {
    this.readyState = 0;
};

Object.defineProperty(XMLHttpRequest.prototype, "responseType", {
    get: function () {
        return this.__responseType || 'text';
    },
    set: function (val) {
        if (val == 'text' || val == 'arraybuffer' || val == 'json' || val == 'moz-chunked-arraybuffer')
            this.__responseType = val;
    }
});

XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    this.readyState = 1;
    this.__request = __createHttpRequest(method, url);
    this._notifyReadyStateChange();
};

XMLHttpRequest.prototype.abort = function() {
    this.__aborted = true;
}

XMLHttpRequest.prototype.send = function (requestData) {
    if (requestData != null)
        this.__request.setBody(__newStringBody(new Buffer(requestData).toString()));

    var chunked = this.responseType == 'moz-chunked-arraybuffer';

    if (this.__request.getUri().getScheme() == null) {
        setImmediate(function() {
            try {
                var u = this.__request.getUri().toString();
                var result = __scriptAPIs.readResource(u);

                this.status = 200;
                this.statusText = 'OK';
                this.responseURL = u;
                this.responseHeaders = {};
                this.readyState = 4;

                if (this.responseType == 'json') {
                    this.response = JSON.parse(result);
                }
                else if (this.responseType == 'arraybuffer') {
                    this.response = new Buffer(result);
                }
                else if (chunked) {
                    if (result) {
                        this.response = new Buffer(result);
                        this.readyState = 3;
                    }
                }
                else {
                    this.responseText = new Buffer(result).toString();
                }

                this._notifyReadyStateChange();
            }
            catch (e) {
                if (this.onerror)
                    this.onerror(new Error(e));
            }
        }.bind(this));
        return;
    }

    (chunked ? __executeChunkedHttpRequest : __executeHttpRequest)(this.__request, function (e, result, code, message, headers, responseURL) {
        if (e != null) {
            if (this.onerror)
                this.onerror(new Error(e));
            return;
        }

        this.status = code;
        this.statusText = message;
        this.responseURL = responseURL;

        this.responseHeaders = headers;
        this.readyState = 4;
        if (this.responseType == 'json') {
            try {
                this.response = JSON.parse(result);
            }
            catch (e) {
                this.onerror(e);
                return;
            }
        }
        else if (this.responseType == 'arraybuffer') {
            this.response = new Buffer(result);
        }
        else if (chunked) {
            if (result) {
                this.response = new Buffer(result);
                this.readyState = 3;
            }
        }
        else {
            this.responseText = result;
        }

        this._notifyReadyStateChange();
    }.bind(this));
};

XMLHttpRequest.prototype._notifyReadyStateChange = function () {
    if (this.onreadystatechange && !this.__aborted) {
        this.onreadystatechange();
    }
}

XMLHttpRequest.prototype.getAllResponseHeaders = function () {
    return this.responseHeaders;
}

XMLHttpRequest.prototype.setRequestHeader = function (key, val) {
    this.__request.setHeader(key, val);
}

