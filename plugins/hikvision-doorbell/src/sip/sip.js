var util = require('util');
var net = require('net');
var dns = require('dns');
var assert = require('assert');
var dgram = require('dgram');
var tls = require('tls');
var os = require('os');
var crypto = require('crypto');
var WebSocket = require('ws');

function debug(e) {
  if(e.stack) {
    util.debug(e + '\n' + e.stack);
  }
  else
    util.debug(util.inspect(e));
}

function toBase64(s) { 
  switch(s.length % 3) {
  case 1:
    s += '  ';
    break;
  case 2:
    s += ' ';
    break;
  default:
  }

  return (new Buffer.from(s)).toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
}
// Actual stack code begins here

function parseResponse(rs, m) {
  var r = rs.match(/^SIP\/(\d+\.\d+)\s+(\d+)\s*(.*)\s*$/);

  if(r) {
    m.version = r[1];
    m.status = +r[2];
    m.reason = r[3];

    return m;
  }  
}

function parseRequest(rq, m) {
  var r = rq.match(/^([\w\-.!%*_+`'~]+)\s([^\s]+)\sSIP\s*\/\s*(\d+\.\d+)/);

  if(r) {
    m.method = unescape(r[1]);
    m.uri = r[2];
    m.version = r[3];

    return m;
  }
}

function applyRegex(regex, data) {
  regex.lastIndex = data.i;
  var r = regex.exec(data.s);

  if(r && (r.index === data.i)) {
    data.i = regex.lastIndex;
    return r;
  }
}

function parseParams(data, hdr) {
  hdr.params = hdr.params || {};

  var re = /\s*;\s*([\w\-.!%*_+`'~]+)(?:\s*=\s*([\w\-.!%*_+`'~]+|"[^"\\]*(\\.[^"\\]*)*"))?/g; 
  
  for(var r = applyRegex(re, data); r; r = applyRegex(re, data)) {
    hdr.params[r[1].toLowerCase()] = r[2] || null;
  }

  return hdr;
}

function parseMultiHeader(parser, d, h) {
  h = h || [];

  var re = /\s*,\s*/g;
  do {
    h.push(parser(d));
  } while(d.i < d.s.length && applyRegex(re, d));

  return h;
}

function parseGenericHeader(d, h) {
  return h ? h + ',' + d.s : d.s;
}

function parseAOR(data) {
  var r = applyRegex(/((?:[\w\-.!%*_+`'~]+)(?:\s+[\w\-.!%*_+`'~]+)*|"[^"\\]*(?:\\.[^"\\]*)*")?\s*\<\s*([^>]*)\s*\>|((?:[^\s@"<]@)?[^\s;]+)/g, data);

  return parseParams(data, {name: r[1], uri: r[2] || r[3] || ''});
}
exports.parseAOR = parseAOR;

function parseAorWithUri(data) {
  var r = parseAOR(data);
  r.uri = parseUri(r.uri);
  return r;
}

function parseVia(data) {
  var r = applyRegex(/SIP\s*\/\s*(\d+\.\d+)\s*\/\s*([\S]+)\s+([^\s;:]+)(?:\s*:\s*(\d+))?/g, data);
  return parseParams(data, {version: r[1], protocol: r[2], host: r[3], port: r[4] && +r[4]});
}

function parseCSeq(d) {
  var r = /(\d+)\s*([\S]+)/.exec(d.s);
  return { seq: +r[1], method: unescape(r[2]) };
}

function parseAuthHeader(d) {
  var r1 = applyRegex(/([^\s]*)\s+/g, d);
  var a = {scheme: r1[1]};

  var r2 = applyRegex(/([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d);
  a[r2[1]]=r2[2];

  while(r2 = applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d)) {
    a[r2[1]]=r2[2];
  }

  return a;
}

function parseAuthenticationInfoHeader(d) {
  var a = {};
  var r = applyRegex(/([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d);
  a[r[1]]=r[2];

  while(r = applyRegex(/,\s*([^\s,"=]*)\s*=\s*([^\s,"]+|"[^"\\]*(?:\\.[^"\\]*)*")\s*/g, d)) {
    a[r[1]]=r[2];
  }
  return a;
}

var compactForm = {
  i: 'call-id',
  m: 'contact',
  e: 'contact-encoding',
  l: 'content-length',
  c: 'content-type',
  f: 'from',
  s: 'subject',
  k: 'supported',
  t: 'to',
  v: 'via'
};

var parsers = {
  'to': parseAOR,
  'from': parseAOR,
  'contact': function(v, h) {
    if(v == '*')
      return v;
    else
      return parseMultiHeader(parseAOR, v, h);
  },
  'route': parseMultiHeader.bind(0, parseAorWithUri),
  'record-route': parseMultiHeader.bind(0, parseAorWithUri),
  'path': parseMultiHeader.bind(0, parseAorWithUri),
  'cseq': parseCSeq,
  'content-length': function(v) { return +v.s; },
  'via': parseMultiHeader.bind(0, parseVia),
  'www-authenticate': parseMultiHeader.bind(0, parseAuthHeader),
  'proxy-authenticate': parseMultiHeader.bind(0, parseAuthHeader),
  'authorization': parseMultiHeader.bind(0, parseAuthHeader),
  'proxy-authorization': parseMultiHeader.bind(0, parseAuthHeader),
  'authentication-info': parseAuthenticationInfoHeader,
  'refer-to': parseAOR
};

function parse(data) {
  data = data.split(/\r\n(?![ \t])/);

  if(data[0] === '')
    return;

  var m = {};

  if(!(parseResponse(data[0], m) || parseRequest(data[0], m)))
    return;

  m.headers = {};

  for(var i = 1; i < data.length; ++i) {
    var r = data[i].match(/^([\S]*?)\s*:\s*([\s\S]*)$/);
    if(!r) {
      return;
    }

    var name = unescape(r[1]).toLowerCase();
    name = compactForm[name] || name;

    try {
      m.headers[name] = (parsers[name] || parseGenericHeader)({s:r[2], i:0}, m.headers[name]);
    }
    catch(e) {}
  }

  return m;
}

function parseUri(s) {
  if(typeof s === 'object')
    return s;

  var re = /^(sips?):(?:([^\s>:@]+)(?::([^\s@>]+))?@)?([\w\-\.]+)(?::(\d+))?((?:;[^\s=\?>;]+(?:=[^\s?\;]+)?)*)(?:\?(([^\s&=>]+=[^\s&=>]+)(&[^\s&=>]+=[^\s&=>]+)*))?$/;

  var r = re.exec(s);

  if(r) {
    return {
      schema: r[1],
      user: r[2],
      password: r[3],
      host: r[4],
      port: +r[5],
      params: (r[6].match(/([^;=]+)(=([^;=]+))?/g) || [])
        .map(function(s) { return s.split('='); })
        .reduce(function(params, x) { params[x[0]]=x[1] || null; return params;}, {}),
      headers: ((r[7] || '').match(/[^&=]+=[^&=]+/g) || [])
        .map(function(s){ return s.split('=') })
        .reduce(function(params, x) { params[x[0]]=x[1]; return params; }, {})
    }
  }
}

exports.parseUri = parseUri;

function stringifyVersion(v) {
  return v || '2.0';
}

function stringifyParams(params) {
  var s = '';
  for(var n in params) {
      s += ';'+n+(params[n]?'='+params[n]:'');
  }

  return s;
}

function stringifyUri(uri) {
  if(typeof uri === 'string')
    return uri;

  var s = (uri.schema || 'sip') + ':';

  if(uri.user) {
    if(uri.password)
      s += uri.user + ':' + uri.password + '@';
    else
      s += uri.user + '@';
  }

  s += uri.host;

  if(uri.port)
    s += ':' + uri.port;

  if(uri.params)
    s += stringifyParams(uri.params);

  if(uri.headers) {
    var h = Object.keys(uri.headers).map(function(x){return x+'='+uri.headers[x];}).join('&');
    if(h.length)
      s += '?' + h; 
  }
  return s;
}

exports.stringifyUri = stringifyUri;

function stringifyAOR(aor) {
  return (aor.name || '') + ' <' + stringifyUri(aor.uri) + '>'+stringifyParams(aor.params); 
}

function stringifyAuthHeader(a) {
  var s = [];

  for(var n in a) {
    if(n !== 'scheme' && a[n] !== undefined) {
      s.push(n + '=' + a[n]);
    }
  }

  return a.scheme ? a.scheme + ' ' + s.join(',') : s.join(',');
}

exports.stringifyAuthHeader = stringifyAuthHeader;

var stringifiers = {
  via: function(h) {
    return h.map(function(via) {
      if(via.host) {
        return 'Via: SIP/'+stringifyVersion(via.version)+'/'+via.protocol.toUpperCase()+' '+via.host+(via.port?':'+via.port:'')+stringifyParams(via.params)+'\r\n';
      }
      else {
        return '';
      }
    }).join('');
  },
  to: function(h) {
    return 'To: '+stringifyAOR(h) + '\r\n';
   },
  from: function(h) {
    return 'From: '+stringifyAOR(h)+'\r\n';
  },
  contact: function(h) { 
    return 'Contact: '+ ((h !== '*' && h.length) ? h.map(stringifyAOR).join(', ') : '*') + '\r\n';
  },
  route: function(h) {
    return h.length ? 'Route: ' + h.map(stringifyAOR).join(', ') + '\r\n' : '';
  },
  'record-route': function(h) {
    return h.length ? 'Record-Route: ' + h.map(stringifyAOR).join(', ') + '\r\n' : '';
  },
  'path': function(h) { 
    return h.length ? 'Path: ' + h.map(stringifyAOR).join(', ') + '\r\n' : '';
  },
  cseq: function(cseq) { 
    return 'CSeq: '+cseq.seq+' '+cseq.method+'\r\n';
  },
  'www-authenticate': function(h) { 
    return h.map(function(x) { return 'WWW-Authenticate: '+stringifyAuthHeader(x)+'\r\n'; }).join('');
  },
  'proxy-authenticate': function(h) { 
    return h.map(function(x) { return 'Proxy-Authenticate: '+stringifyAuthHeader(x)+'\r\n'; }).join('');
  },
  'authorization': function(h) {
    return h.map(function(x) { return 'Authorization: ' + stringifyAuthHeader(x) + '\r\n'}).join('');
  },
  'proxy-authorization': function(h) {
    return h.map(function(x) { return 'Proxy-Authorization: ' + stringifyAuthHeader(x) + '\r\n'}).join('');; 
  },
  'authentication-info': function(h) {
    return 'Authentication-Info: ' + stringifyAuthHeader(h) + '\r\n';
  },
  'refer-to': function(h) { return 'Refer-To: ' + stringifyAOR(h) + '\r\n'; }
};

function prettifyHeaderName(s) {
  if(s == 'call-id') return 'Call-ID';

  return s.replace(/\b([a-z])/g, function(a) { return a.toUpperCase(); });
}

function stringify(m) {
  var s;
  if(m.status) {
    s = 'SIP/' + stringifyVersion(m.version) + ' ' + m.status + ' ' + m.reason + '\r\n';
  }
  else {
    s = m.method + ' ' + stringifyUri(m.uri) + ' SIP/' + stringifyVersion(m.version) + '\r\n';
  }

  m.headers['content-length'] = (m.content || '').length;

  for(var n in m.headers) {
    if(typeof m.headers[n] !== "undefined") {
      if(typeof m.headers[n] === 'string' || !stringifiers[n]) 
        s += prettifyHeaderName(n) + ': ' + m.headers[n] + '\r\n';
      else
        s += stringifiers[n](m.headers[n], n);
    }
  }
  
  s += '\r\n';

  if(m.content)
    s += m.content;

  return s;
}

exports.stringify = stringify;

function makeResponse(rq, status, reason, extension) {
  var rs = {
    status: status,
    reason: reason || '',
    version: rq.version,
    headers: {
      via: rq.headers.via,
      to: rq.headers.to,
      from: rq.headers.from,
      'call-id': rq.headers['call-id'],
      cseq: rq.headers.cseq
    }
  };

  if(extension) {
    if(extension.headers) Object.keys(extension.headers).forEach(function(h) { rs.headers[h] = extension.headers[h]; });
    rs.content = extension.content;
  }

  return rs;
}

exports.makeResponse = makeResponse;

function clone(o, deep) {
  if(o !== null && typeof o === 'object') {
    var r = Array.isArray(o) ? [] : {};
    Object.keys(o).forEach(function(k) { r[k] = deep ? clone(o[k], deep): o[k]; });
    return r;
  }

  return o;
}

exports.copyMessage = function(msg, deep) {
  if(deep) return clone(msg, true);

  var r = {
    uri: deep ? clone(msg.uri, deep) : msg.uri,
    method: msg.method,
    status: msg.status,
    reason: msg.reason,
    headers: clone(msg.headers, deep),
    content: msg.content
  };

  // always copy via array 
  r.headers.via = clone(msg.headers.via);

  return r;
}

function defaultPort(proto) {
  return proto.toUpperCase() === 'TLS' ? 5061 : 5060;
}

function makeStreamParser(onMessage, onFlood, maxBytesHeaders, maxContentLength) {

  onFlood= onFlood || function(){};
  maxBytesHeaders= maxBytesHeaders || 60480;
  maxContentLength= maxContentLength || 604800;

  var m;
  var r = '';
  
  function headers(data) {
    r += data;

    if( r.length > maxBytesHeaders ){

      r = '';

      onFlood();

      return;

    }

    var a = r.match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);

    if(a) {
      r = a[2];
      m = parse(a[1]);

      if(m && m.headers['content-length'] !== undefined) {

        if (m.headers['content-length'] > maxContentLength) {

          r = '';

          onFlood();

        }

        state = content;
        content('');
      }
      else
        headers('');
    }
  }

  function content(data) {
    r += data;

    if(r.length >= m.headers['content-length']) {
      m.content = r.substring(0, m.headers['content-length']);
      
      onMessage(m);
      
      var s = r.substring(m.headers['content-length']);
      state = headers;
      r = '';
      headers(s);
    }
  }

  var state=headers;

  return function(data) { state(data); }

}
exports.makeStreamParser = makeStreamParser;

function parseMessage(s) {
  var r = s.toString('binary').match(/^\s*([\S\s]*?)\r\n\r\n([\S\s]*)$/);
  if(r) {
    var m = parse(r[1]);

    if(m) {
      if(m.headers['content-length']) {
        var c = Math.max(0, Math.min(m.headers['content-length'], r[2].length));
        m.content = r[2].substring(0, c);
      }
      else {
        m.content = r[2];
      }
      
      return m;
    }
  }
}
exports.parse = parseMessage;

function checkMessage(msg) {
  return (msg.method || (msg.status >= 100 && msg.status <= 999)) &&
    msg.headers &&
    Array.isArray(msg.headers.via) &&
    msg.headers.via.length > 0 &&
    msg.headers['call-id'] &&
    msg.headers.to &&
    msg.headers.from &&
    msg.headers.cseq;
}

function makeStreamTransport(protocol, maxBytesHeaders, maxContentLength, connect, createServer, callback) {
  var remotes = Object.create(null);
  var flows = Object.create(null);

  function init(stream, remote) {
    var remoteid = [remote.address, remote.port].join(),
      flowid = undefined,
      refs = 0;

    function register_flow() {
      flowid = [remoteid,stream.localAddress, stream.localPort].join();
      flows[flowid] = remotes[remoteid];
    }

    var onMessage= function(m) {

      if(checkMessage(m)) {
        if(m.method) m.headers.via[0].params.received = remote.address;
        callback(m,
          {protocol: remote.protocol, address: stream.remoteAddress, port: stream.remotePort, local: { address: stream.localAddress, port: stream.localPort}},
          stream);
      }

    };

    var onFlood= function() {

      console.log("Flood attempt, destroying stream");

      stream.destroy();

    };

    stream.setEncoding('binary');
    stream.on('data', makeStreamParser( onMessage, onFlood, maxBytesHeaders, maxContentLength));
  
    stream.on('close',    function() {
      if(flowid) delete flows[flowid]; 
      delete remotes[remoteid];
    });
    stream.on('connect',  register_flow);

    stream.on('error',    function() {});
    stream.on('end',      function() { 
      if(refs !== 0) stream.emit('error', new Error('remote peer disconnected'));
      stream.end();
    });

    stream.on('timeout',  function() { if(refs === 0) stream.destroy(); });
    stream.setTimeout(120000);   
    stream.setMaxListeners(10000);
 
    remotes[remoteid] = function(onError) {
      ++refs;
      if(onError) stream.on('error', onError);

      return {
        release: function() {
          if(onError) stream.removeListener('error', onError);
          if(--refs === 0) stream.emit('no_reference');
        },
        send: function(m) {
          stream.write(stringify(m), 'binary');
        },
        protocol: protocol
      }
    };

    if(stream.localPort) register_flow();

    return remotes[remoteid];
  }

  var server = createServer(function(stream) {
    init(stream, {protocol: protocol, address: stream.remoteAddress, port: stream.remotePort});  
  });

  return {
    open: function(remote, error) {
      var remoteid = [remote.address, remote.port].join();

      if(remoteid in remotes) return remotes[remoteid](error);

      return init(connect(remote.port, remote.address), remote)(error);
    },
    get: function(address, error) {
      var c = address.local ? flows[[address.address, address.port, address.local.address, address.local.port].join()]
        : remotes[[address.address, address.port].join()];

      return c && c(error);
    },
    destroy: function() { server.close(); }
  };
}

function makeTlsTransport(options, callback) {
  return makeStreamTransport(
    'TLS', 
    options.maxBytesHeaders,
    options.maxContentLength,
    function(port, host, callback) { return tls.connect(port, host, options.tls, callback); }, 
    function(callback) {
      var server = tls.createServer(options.tls, callback);
      server.listen(options.tls_port || 5061, options.address);
      return server;
    },
    callback);
}

function makeTcpTransport(options, callback) {
  return makeStreamTransport(
    'TCP',
    options.maxBytesHeaders,
    options.maxContentLength,
    function(port, host, callback) { return net.connect(port, host, callback); },
    function(callback) { 
      var server = net.createServer(callback);
      server.listen(options.port || 5060, options.address);
      return server;
    },
    callback);
}

function makeWsTransport(options, callback) {
  var flows = Object.create(null);
  var clients = Object.create(null);

  
  function init(ws) {
    var remote = {address: ws._socket.remoteAddress, port: ws._socket.remotePort},
        local = {address: ws._socket.address().address, port: ws._socket.address().port},
        flowid = [remote.address, remote.port, local.address, local.port].join();

    flows[flowid] = ws;

    ws.on('close', function() { delete flows[flowid]; });
    ws.on('message', function(data) {
      var msg = parseMessage(data);
      if(msg) {
        callback(msg, {protocol: 'WS', address: remote.address, port: remote.port, local: local});
      }
    });
  }

  function makeClient(uri) {
    if(clients[uri]) return clients[uri]();

    var socket = new WebSocket(uri, 'sip', {procotol: 'sip'}),
        queue = [],
        refs = 0;
    
    function send_connecting(m) { queue.push(stringify(m)); }
    function send_open(m) { socket.send(new Buffer.from(typeof m === 'string' ? m : stringify(m), 'binary')); }
    var send = send_connecting;

    socket.on('open', function() { 
      init(socket); 
      send = send_open;
      queue.splice(0).forEach(send);
    });

    function open(onError) {
      ++refs;
      if(onError) socket.on('error', onError);
      return {
        send: function(m) { send(m); },
        release: function() {
          if(onError) socket.removeListener('error', onError);
          if(--refs === 0) socket.terminate();
        },
        protocol: 'WS'
      };
    };

    return clients[uri] = open;
  }

  if(options.ws_port) {
    if(options.tls) {
      var http = require('https');
      var server = new WebSocket.Server({
          server: http.createServer(options.tls, function(rq,rs) { 
            rs.writeHead(200);
            rs.end("");
          }).listen(options.ws_port)
      });
    } 
    else {
      var server = new WebSocket.Server({port:options.ws_port});
    }

    server.on('connection',init);
  }

  function get(flow) {
    var ws = flows[[flow.address, flow.port, flow.local.address, flow.local.port].join()];
    if(ws) {
      return {
        send: function(m) { ws.send(stringify(m)); },
        release: function() {},
        protocol: 'WS'
      };
    } else {
        console.log("Failed to get ws for target. Target/flow was:");
        console.log(util.inspect(flow));
        console.log("Flows[] were:");
        console.log(util.inspect(flows));
    }
  }

  function open(target, onError) {
    if(target.local)
      return get(target); 
    else
      return makeClient('ws://'+target.host+':'+target.port)(onError);
  }

  return {
    get: open,
    open: open,
    destroy: function() { server.close(); }
  }
}

async function makeUdpTransport(options, callback) {

  return new Promise ((resolve, reject) => {

    function onMessage(data, rinfo) {
      var msg = parseMessage(data);
     
      if(msg && checkMessage(msg)) {
        if(msg.method) {
          msg.headers.via[0].params.received = rinfo.address;
          if(msg.headers.via[0].params.hasOwnProperty('rport'))
            msg.headers.via[0].params.rport = rinfo.port;
        }
  
        callback(msg, {protocol: 'UDP', address: rinfo.address, port: rinfo.port, local: {address: address, port: port}});
      }
    }
    
    function open(remote, error) {
      return {
        send: function(m) {
          var s = stringify(m);
          socket.send(new Buffer.from(s, 'binary'), 0, s.length, remote.port, remote.address);          
        },
        protocol: 'UDP',
        release : function() {}
      }; 
    };
  
    var address = options.address || '0.0.0.0';
    var port = options.port || 5060;
  
    var socket = dgram.createSocket(net.isIPv6(address) ? 'udp6' : 'udp4', onMessage); 
    socket.once ('error', (err) => {
      socket.close();
      reject (err);
    });

    socket.once('listening', () => {
      resolve ({
        open: open,
        get: open,
        destroy: function() { socket.close(); }
      });
    });

    socket.bind(port, address);

  });
}

async function makeTransport(options, callback) {
  var protocols = {};

  var callbackAndLog = callback;
  if(options.logger && options.logger.recv) {
    callbackAndLog = function(m, remote, stream) {
      options.logger.recv(m, remote);
      callback(m, remote, stream);
    }
  }
  
  if(options.udp === undefined || options.udp)
    protocols.UDP = await makeUdpTransport(options, callbackAndLog); 
  if(options.tcp === undefined || options.tcp)
    protocols.TCP = makeTcpTransport(options, callbackAndLog);
  if(options.tls)
    protocols.TLS = makeTlsTransport(options, callbackAndLog);
  if(options.ws_port && WebSocket)
    protocols.WS = makeWsTransport(options, callbackAndLog);

  function wrap(obj, target) {
    return Object.create(obj, {send: {value: function(m) {
      if(m.method) {
        m.headers.via[0].host = options.publicAddress || options.address || options.hostname || os.hostname();
        m.headers.via[0].port = options.port || defaultPort(this.protocol);
        m.headers.via[0].protocol = this.protocol;

        if(this.protocol === 'UDP' && (!options.hasOwnProperty('rport') || options.rport)) {
          m.headers.via[0].params.rport = null;
        }
      }
      options.logger && options.logger.send && options.logger.send(m, target);
      obj.send(m);
    }}});
  }

  return {
    open: function(target, error) {
      return wrap(protocols[target.protocol.toUpperCase()].open(target, error), target);
    },
    get: function(target, error) {
      var flow = protocols[target.protocol.toUpperCase()].get(target, error);
      return flow && wrap(flow, target);
    },
    send: function(target, message) {
      var cn = this.open(target);
      try {
        cn.send(message);
      }
      finally {
        cn.release();
      }
    },
    destroy: function() { 
      var protos = protocols;
      protocols = [];
      Object.keys(protos).forEach(function(key) { protos[key].destroy(); });
    },
  };
}

exports.makeTransport = makeTransport;

function makeWellBehavingResolver(resolve) {
  var outstanding = Object.create(null);
  
  return function(name, cb) {
    if(outstanding[name]) {
      outstanding[name].push(cb);
    }
    else {
      outstanding[name] = [cb];
      
      resolve(name, function() {
        var o = outstanding[name];
        delete outstanding[name];
        var args = arguments;
        o.forEach(function(x) { x.apply(null, args); });
      });
    }
  };
};

var resolveSrv = makeWellBehavingResolver(dns.resolveSrv);
var resolve4 = makeWellBehavingResolver(dns.resolve4);
var resolve6 = makeWellBehavingResolver(dns.resolve6);

function resolve(uri, action) {
  if(uri.params.transport === 'ws')
    return action([{protocol: uri.schema === 'sips' ? 'WSS' : 'WS', host: uri.host, port: uri.port || (uri.schema === 'sips' ? 433 : 80)}]);

  if(net.isIP(uri.host)) {
    var protocol = uri.params.transport || 'UDP';
    return action([{protocol: protocol, address: uri.host, port: uri.port || defaultPort(protocol)}]);
  }
  
  function resolve46(host, cb) {
    resolve4(host, function(e4, a4) {
      resolve6(host, function(e6, a6) {
        if((a4 || a6) && (a4 || a6).length)
          cb(null, (a4 || []).concat(a6 || []));
        else
          cb(e4 || e6, []);
      });
    });
  }

  if(uri.port) {
    var protocols = uri.params.transport ? [uri.params.transport] : ['UDP', 'TCP', 'TLS'];
    
    resolve46(uri.host, function(err, address) {
      address = (address || []).map(function(x) { return protocols.map(function(p) { return { protocol: p, address: x, port: uri.port || defaultPort(p)};});})
        .reduce(function(arr,v) { return arr.concat(v); }, []);
        action(address);
    });
  }
  else {
    var protocols = uri.params.transport ? [uri.params.transport] : ['tcp', 'udp', 'tls'];
  
    var n = protocols.length;
    var addresses = [];

    protocols.forEach(function(proto) {
      resolveSrv('_sip._'+proto+'.'+uri.host, function(e, r) {
        --n;
        
        if(Array.isArray(r)) {
          n += r.length;
          r.forEach(function(srv) {
            resolve46(srv.name, function(e, r) {
              addresses = addresses.concat((r||[]).map(function(a) { return {protocol: proto, address: a, port: srv.port};}));
            
              if((--n)===0) // all outstanding requests has completed
                action(addresses);
            });
          });
        }
        else if(0 === n) {
          if(addresses.length) {
            action(addresses);
          }
          else {
            // all srv requests failed
            resolve46(uri.host, function(err, address) {
              address = (address || []).map(function(x) { return protocols.map(function(p) { return { protocol: p, address: x, port: uri.port || defaultPort(p)};});})
                .reduce(function(arr,v) { return arr.concat(v); }, []);
              action(address);
            });
          }
        }
      })
    });
  }
}

exports.resolve = resolve;

//transaction layer
function generateBranch() {
  return ['z9hG4bK',Math.round(Math.random()*1000000)].join('');
}

exports.generateBranch = generateBranch;

function makeSM() {
  var state;

  return {
    enter: function(newstate) {
      if(state && state.leave)
        state.leave();
      
      state = newstate;
      Array.prototype.shift.apply(arguments);
      if(state.enter) 
        state.enter.apply(this, arguments);
    },
    signal: function(s) {
      if(state && state[s]) 
        state[Array.prototype.shift.apply(arguments)].apply(state, arguments);
    }
  };
}

function createInviteServerTransaction(transport, cleanup) {
  var sm = makeSM();
  var rs;
    
  var proceeding = {
    message: function() { 
      if(rs) transport(rs);
    },
    send: function(message) {
      rs = message;

      if(message.status >= 300)
        sm.enter(completed);
      else if(message.status >= 200)
        sm.enter(accepted);
      
      transport(rs);
    }
  }

  var g, h;
  var completed = {
    enter: function () {
      g = setTimeout(function retry(t) { 
        g = setTimeout(retry, t*2, t*2);
        transport(rs)
      }, 500, 500);
      h = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave: function() {
      clearTimeout(g);
      clearTimeout(h);
    },
    message: function(m) {
      if(m.method === 'ACK')
        sm.enter(confirmed)
      else
        transport(rs);
    }
  }
 
  var timer_i; 
  var confirmed = {
    enter: function() { timer_i = setTimeout(sm.enter.bind(sm, terminated), 5000);},
    leave: function() { clearTimeout(timer_i); }
  };

  var l;
  var accepted = {
    enter: function() { l = setTimeout(sm.enter.bind(sm, terminated), 32000);},
    leave: function() { clearTimeout(l); },
    send: function(m) { 
      rs = m;
      transport(rs);
    }  
  };

  var terminated = {enter: cleanup};
  
  sm.enter(proceeding);

  return {send: sm.signal.bind(sm, 'send'), message: sm.signal.bind(sm,'message'), shutdown: function() { sm.enter(terminated); }};
}

function createServerTransaction(transport, cleanup) {
  var sm = makeSM();
  var rs;

  var trying = {
    message: function() { if(rs) transport(rs); },
    send: function(m) {
      rs = m;
      transport(m);
      if(m.status >= 200) sm.enter(completed);
    }
  }; 

  var j;
  var completed = {
    message: function() { transport(rs); },
    enter: function() { j = setTimeout(function() { sm.enter(terminated); }, 32000); },
    leave: function() { clearTimeout(j); }
  };

  var terminated = {enter: cleanup};

  sm.enter(trying);

  return {send: sm.signal.bind(sm, 'send'), message: sm.signal.bind(sm, 'message'), shutdown: function() { sm.enter(terminated); }};
}

function createInviteClientTransaction(rq, transport, tu, cleanup, options) {
  var sm = makeSM();

  var a, b;
  var calling = {
    enter: function() {
      transport(rq);

      if(!transport.reliable) {
        a = setTimeout(function resend(t) {
          transport(rq);
          a = setTimeout(resend, t*2, t*2);
        }, 500, 500);
      }
        
      b = setTimeout(function() {
        tu(makeResponse(rq, 408));
        sm.enter(terminated);
      }, 32000);
    },
    leave: function() {
      clearTimeout(a);
      clearTimeout(b);
    },
    message: function(message) {
      tu(message);

      if(message.status < 200)
        sm.enter(proceeding);
      else if(message.status < 300) 
         sm.enter(accepted);
      else
        sm.enter(completed, message);
    }
  };

  var ringTimeLimit;
  var proceeding = {
    enter: function() {
      if(options.ringTimeLimit !== 0) {
        ringTimeLimit = setTimeout(function() {
          tu(makeResponse(rq, 408));
          sm.enter(terminated);
        }, options.ringTimeLimit || 600000);
      }
    },
    leave : function() {
      clearTimeout(ringTimeLimit);
    },
    message: function(message) {
      tu(message);
      
      if(message.status >= 300)
        sm.enter(completed, message);
      else if(message.status >= 200)
        sm.enter(accepted);
    }
  };

  var ack = {
    method: 'ACK',
    uri: rq.uri,
    headers: {
      from: rq.headers.from,
      cseq: {method: 'ACK', seq: rq.headers.cseq.seq},
      'call-id': rq.headers['call-id'],
      via: [rq.headers.via[0]],
      'max-forwards': (options && options['max-forwards']) || 70 
    }
  };

  var d;
  var completed = {
    enter: function(rs) {
      ack.headers.to=rs.headers.to;
      transport(ack);
      d = setTimeout(sm.enter.bind(sm, terminated), 32000);
    },
    leave: function() { clearTimeout(d); },
    message: function(message, remote) {
      if(remote) transport(ack);  // we don't want to ack internally generated messages
    }
  };

  var timer_m;
  var accepted = {
    enter: function() {
      timer_m = setTimeout(function() { sm.enter(terminated); }, 32000);
    },
    leave: function() { clearTimeout(timer_m); },
    message: function(m) {
      if(m.status >= 200 && m.status <= 299)
        tu(m);
    }
  };

  var terminated = {enter: cleanup};
 
  process.nextTick(function(){ sm.enter(calling); });
 
  return {message: sm.signal.bind(sm, 'message'), shutdown: function() { sm.enter(terminated); }};
}

function createClientTransaction(rq, transport, tu, cleanup) {  
  assert.ok(rq.method !== 'INVITE');

  var sm = makeSM();
  
  var e, f;
  var trying = {
    enter: function() { 
      transport(rq);
      if(!transport.reliable)
        e = setTimeout(function() { sm.signal('timerE', 500); }, 500);
      f = setTimeout(function() { sm.signal('timerF'); }, 32000);
    },
    leave: function() {
      clearTimeout(e);
      clearTimeout(f);
    },
    message: function(message, remote) {
      if(message.status >= 200)
        sm.enter(completed);
      else
        sm.enter(proceeding);
      tu(message);
    },
    timerE: function(t) {
      transport(rq);
      e = setTimeout(function() { sm.signal('timerE', t*2); }, t*2);
    },
    timerF: function() {
      tu(makeResponse(rq, 408));
      sm.enter(terminated);
    }
  };

  var ringTimeLimit;
  var proceeding = {
    enter: function() {
      if(options.ringTimeLimit !== 0) {
        ringTimeLimit = setTimeout(function() {
          tu(makeResponse(rq, 408));
          sm.enter(terminated);
        }, options.ringTimeLimit || 600000);
      }
    },
    leave : function() {
      clearTimeout(ringTimeLimit);
    },
    message: function(message, remote) {
      if(message.status >= 200)
        sm.enter(completed);
      tu(message);
    }
  };

  var k;
  var completed = {
    enter: function() { k = setTimeout(function() { sm.enter(terminated); }, 5000); },
    leave: function() { clearTimeout(k); }
  };

  var terminated = {enter: cleanup};

  process.nextTick(function() { sm.enter(trying); });

  return {message: sm.signal.bind(sm, 'message'), shutdown: function() { sm.enter(terminated); }};
}

function makeTransactionId(m) {
  if(m.method === 'ACK')
    return ['INVITE', m.headers['call-id'], m.headers.via[0].params.branch].join();
  return [m.headers.cseq.method, m.headers['call-id'], m.headers.via[0].params.branch].join();
}

function makeTransactionLayer(options, transport) {
  var server_transactions = Object.create(null);
  var client_transactions = Object.create(null);

  return {
    createServerTransaction: function(rq, cn) {
      var id = makeTransactionId(rq);
      
      return server_transactions[id] = (rq.method === 'INVITE' ? createInviteServerTransaction : createServerTransaction)(
        cn.send.bind(cn),
        function() { 
          delete server_transactions[id];
          cn.release();
        });
    },
    createClientTransaction: function(connection, rq, callback) {
      if(rq.method !== 'CANCEL') rq.headers.via[0].params.branch = generateBranch();
      
      
      if(typeof rq.headers.cseq !== 'object')
        rq.headers.cseq = parseCSeq({s: rq.headers.cseq, i:0});

      var send = connection.send.bind(connection);
      send.reliable = connection.protocol.toUpperCase() !== 'UDP';
      
      var id = makeTransactionId(rq);
      return client_transactions[id] = 
        (rq.method === 'INVITE' ? createInviteClientTransaction : createClientTransaction)(rq, send, callback, function() { 
          delete client_transactions[id];
          connection.release();
        }, 
        options);
    },
    getServer: function(m) {
      return server_transactions[makeTransactionId(m)];
    },
    getClient: function(m) {
      return client_transactions[makeTransactionId(m)];
    },
    destroy: function() {
      Object.keys(client_transactions).forEach(function(x) { client_transactions[x].shutdown(); });
      Object.keys(server_transactions).forEach(function(x) { server_transactions[x].shutdown(); });
    }
  };
}

exports.makeTransactionLayer = makeTransactionLayer;

function sequentialSearch(transaction, connect, addresses, rq, callback) {
  if(rq.method !== 'CANCEL') {
    if(!rq.headers.via) rq.headers.via = [];
    rq.headers.via.unshift({params:{}});
  }

  var onresponse;
  var lastStatusCode;
  function next() {
    onresponse = searching;
    
    if(addresses.length > 0) {
      try {
        var address = addresses.shift();
        var client = transaction(connect(address, function(err) {
          if(err) {
            console.log("err: ", err);
          }
          client.message(makeResponse(rq, 503));
        }), rq, function() { onresponse.apply(null, arguments); }); 
      }
      catch(e) {
        onresponse(address.local ? makeResponse(rq, 430) : makeResponse(rq, 503));  
      }
    }
    else {
      onresponse = callback;
      onresponse(makeResponse(rq, lastStatusCode || 404));
    }
  }

  function searching(rs) {
    lastStatusCode = rs.status;
    if(rs.status === 503)
      return next();
    else if(rs.status > 100)
      onresponse = callback;
    
    callback(rs);
  }
 
  next();
}

exports.create = async function(options, callback) {
  var errorLog = (options.logger && options.logger.error) || function() {};

  var transport = await makeTransport(options, function(m,remote) {
    try {
      var t = m.method ? transaction.getServer(m) : transaction.getClient(m);

      if(!t) {
        if(m.method && m.method !== 'ACK') {
          var t = transaction.createServerTransaction(m, transport.get(remote));
          try {
            callback(m,remote);
          } catch(e) {
            t.send(makeResponse(m, '500', 'Internal Server Error'));
            throw e;
          } 
        }
        else if(m.method === 'ACK') {
          callback(m,remote);
        }
      }
      else {
        t.message && t.message(m, remote);
      }
    } 
    catch(e) {
      errorLog(e);
    }
  });
  
  var transaction = makeTransactionLayer(options, transport.open.bind(transport));
  var hostname = options.publicAddress || options.address || options.hostname || os.hostname();
  var port = options.port || 5060;
  var rbytes = crypto.randomBytes(20);

  function encodeFlowToken(flow) {
    var s = [flow.protocol, flow.address, flow.port, flow.local.address, flow.local.port].join();
    var h = crypto.createHmac('sha1', rbytes);
    h.update(s);
    return toBase64([h.digest('base64'), s].join());
  }

  function decodeFlowToken(token) {
    var s = (new Buffer.from(token, 'base64')).toString('ascii').split(',');
    if(s.length != 6) return;

    var flow = {protocol: s[1], address: s[2], port: +s[3], local: {address: s[4], port: +s[5]}};

    return encodeFlowToken(flow) == token ? flow : undefined;
  }       
  
  return {
    send: function(m, callback) {
      if(m.method === undefined) {
        var t = transaction.getServer(m);
        t && t.send && t.send(m);
      }
      else {
        var hop = parseUri(m.uri);

        if(typeof m.headers.route === 'string') {
          try {
            m.headers.route = parsers.route({s: m.headers.route, i:0});
          }
          catch(e) {
            m.headers.route = undefined;
          }
        }

        if(m.headers.route && m.headers.route.length > 0) {
          hop = parseUri(m.headers.route[0].uri);
          if(hop.host === hostname && hop.port === port) {
            m.headers.route.shift();
          } 
          else if(hop.params.lr === undefined ) {
            m.headers.route.shift();
            m.headers.route.push({uri: m.uri});
            m.uri = hop;
          }
        }

        (function(callback) {
          if(hop.host === hostname && hop.port === port) {
            var flow = decodeFlowToken(hop.user);
            callback(flow ? [flow] : []);
          }
          else
            resolve(hop, callback);
        })(function(addresses) {
          if(m.method === 'ACK') {
            if(!Array.isArray(m.headers.via))
              m.headers.via = [];

            if(m.headers.via.length === 0)
              m.headers.via.unshift({params: {branch: generateBranch()}});
            
            if(addresses.length === 0) {
              errorLog(new Error("ACK: couldn't resolve " + stringifyUri(m.uri)));
              return;
            }

            var cn = transport.open(addresses[0], errorLog);
            try {
              cn.send(m);
            } 
            catch(e) {
              errorLog(e);
            }
            finally {
              cn.release();
            }
          }
          else
            sequentialSearch(transaction.createClientTransaction.bind(transaction), transport.open.bind(transport), addresses, m, callback || function() {}); 
        });
      }
    },
    encodeFlowUri: function(flow) {
      return {schema: flow.protocol === 'TLS' ? 'sips' : 'sip', user: encodeFlowToken(flow), host: hostname, params:{}};
    },
    decodeFlowUri: function(uri) {
      uri = parseUri(uri);
      return uri.host === hostname ? decodeFlowToken(uri.user) : undefined;
    },
    isFlowUri: function(uri) {
      return !!!decodeFlowUri(uri);
    },
    hostname: function() { return hostname; },
    destroy: function() {
      transaction.destroy();
      transport.destroy();
    }
  } 
}

exports.start = async function(options, callback) {
  var r = await exports.create(options, callback);

  exports.send = r.send;
  exports.stop = r.destroy;
  exports.encodeFlowUri = r.encodeFlowUri;
  exports.decodeFlowUri = r.decodeFlowUri;
  exports.isFlowUri = r.isFlowUri;
  exports.hostname = r.hostname;
}

