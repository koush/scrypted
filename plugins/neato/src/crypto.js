const cryptojsCreateHmac = require("crypto-js/hmac-sha256");
const cryptojsEncHex = require('crypto-js/enc-hex');

function HmacSha256Shim(sha256, key) {
    if (sha256 != 'sha256')
        throw new Error('expected sha256');
    this.key = key;
}

HmacSha256Shim.prototype.update = function (data) {
    if (this.data)
        throw new Error('already have data');
    this.data = data;
    return this;
}

HmacSha256Shim.prototype.digest = function (hex) {
    if (hex != 'hex')
        throw new Error('expected hex');
    return cryptojsCreateHmac(this.data, this.key).toString(cryptojsEncHex);
}

// exports.createHmac = function(sha256, secret) {
//     return new HmacSha256Shim(sha256, secret);
// }

function createHmac(sha256, secret) {
    return new HmacSha256Shim(sha256, secret);
}

export { createHmac };
