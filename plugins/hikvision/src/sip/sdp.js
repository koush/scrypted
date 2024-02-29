var util = require('util');

var parsers = {
  o: function(o) {
    var t = o.split(/\s+/);
    return {
      username: t[0],
      id : t[1],
      version : t[2],
      nettype : t[3],
      addrtype : t[4],
      address : t[5]
    };
  },
  c: function(c) {
    var t = c.split(/\s+/);
    return { nettype: t[0], addrtype: t[1], address: t[2] };
  },
  m: function(m) {
    var t = /^(\w+) +(\d+)(?:\/(\d))? +(\S+) (\d+( +\d+)*)/.exec(m);

    return {
      media: t[1],
      port: +t[2],
      portnum: +(t[3] || 1),
      proto: t[4],
      fmt: t[5].split(/\s+/).map(function(x) { return +x; })
    };
  },
  a: function(a) {
    return a;
  }
};

exports.parse = function(sdp) {
  var sdp = sdp.split(/\r\n/);
  
  var root = {};
  var m;
  root.m = [];

  for(var i = 0; i < sdp.length; ++i) {
    var tmp = /^(\w)=(.*)/.exec(sdp[i]);
    
    if(tmp) {

    var c = (parsers[tmp[1]] || function(x) { return x;})(tmp[2]);
    switch(tmp[1]) {
    case 'm':
      if(m) root.m.push(m);
      m = c;
      break;
    case 'a':
      var o = (m || root);
      if(o.a === undefined) o.a = [];
      o.a.push(c);
      break;
    default:
      (m || root)[tmp[1]] = c;
      break;
    }
    }
  }

  if(m) root.m.push(m);
  
  return root;
};

var stringifiers = {
  o: function(o) {
    return [o.username || '-', o.id, o.version, o.nettype || 'IN', o.addrtype || 'IP4', o.address].join(' '); 
  },
  c: function(c) {
    return [c.nettype || 'IN', c.addrtype || 'IP4', c.address].join(' ');
  },
  m: function(m) {
    return [m.media || 'audio', m.port, m.proto || 'RTP/AVP', m.fmt.join(' ')].join(' ');
  }
};

function stringifyParam(sdp, type, def) {
  if(sdp[type] !== undefined) {
    var stringifier = function(x) { return type + '=' + ((stringifiers[type] && stringifiers[type](x)) || x) + '\r\n'; };

    if(Array.isArray(sdp[type]))
      return sdp[type].map(stringifier).join('');

    return stringifier(sdp[type]);
  }

  if(def !== undefined)
    return type + '=' + def + '\r\n';
  return '';
}

exports.stringify = function(sdp) {
  var s = '';
  
  s += stringifyParam(sdp, 'v', 0);
  s +=  stringifyParam(sdp, 'o');
  s +=  stringifyParam(sdp, 's', '-');
  s +=  stringifyParam(sdp, 'i');
  s +=  stringifyParam(sdp, 'u');
  s +=  stringifyParam(sdp, 'e');
  s +=  stringifyParam(sdp, 'p');
  s +=  stringifyParam(sdp, 'c');
  s +=  stringifyParam(sdp, 'b');
  s +=  stringifyParam(sdp, 't', '0 0');
  s +=  stringifyParam(sdp, 'r');
  s +=  stringifyParam(sdp, 'z');
  s +=  stringifyParam(sdp, 'k');
  s +=  stringifyParam(sdp, 'a');
  sdp.m.forEach(function(m) {
    s += stringifyParam({m:m}, 'm');
    s +=  stringifyParam(m, 'i');
    s +=  stringifyParam(m, 'c');
    s +=  stringifyParam(m, 'b');
    s +=  stringifyParam(m, 'k');
    s +=  stringifyParam(m, 'a');
  });

  return s;
}


