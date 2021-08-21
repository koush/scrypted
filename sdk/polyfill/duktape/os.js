var ip = {};

ip.toString = function(buff, offset, length) {
  offset = ~~offset;
  length = length || (buff.length - offset);

  var result = [];
  if (length === 4) {
    // IPv4
    for (var i = 0; i < length; i++) {
      result.push(buff[offset + i]);
    }
    result = result.join('.');
  } else if (length === 16) {
    // IPv6
    for (var i = 0; i < length; i += 2) {
      result.push(buff.readUInt16BE(offset + i).toString(16));
    }
    result = result.join(':');
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
    result = result.replace(/:{3,4}/, '::');
  }

  return result;
};

function _normalizeFamily(family) {
  return family ? family.toLowerCase() : 'ipv4';
}

ip.fromPrefixLen = function(prefixlen, family) {
  if (prefixlen > 32) {
    family = 'ipv6';
  } else {
    family = _normalizeFamily(family);
  }

  var len = 4;
  if (family === 'ipv6') {
    len = 16;
  }
  var buff = new Buffer(len);

  for (var i = 0, n = buff.length; i < n; ++i) {
    var bits = 8;
    if (prefixlen < 8) {
      bits = prefixlen;
    }
    prefixlen -= bits;

    buff[i] = ~(0xff >> bits) & 0xff;
  }

  return ip.toString(buff);
};

function networkInterfaces() {
    var nis = __getNetworkInterfaces();

    var ret = {};
    for (var i = 0; i < nis.length; i++) {
        var ni = nis[i];
        var iface = [];
        ret[ni.getName()] = iface;
        var addrs = ni.getInterfaceAddresses();
        for (var j = 0; j < addrs.size(); j++) {
            var addr = addrs.get(j);
            iface.push({
                address: addr.getAddress().getHostAddress(),
                family: addr.getBroadcast() ? 'IPv4' : 'IPv6',
                internal: ni.isLoopback() || ni.isVirtual(),
                netmask: ip.fromPrefixLen(addr.getNetworkPrefixLength()),
            });
        }
    }
    return ret;
}

export {
    networkInterfaces
}