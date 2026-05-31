var crypto = require('crypto');
var util = require('util');
var stringifyUri = require('./sip').stringifyUri; 

function unq(a) {
  if(a && a[0] === '"' && a[a.length-1] === '"')
    return a.substr(1, a.length - 2);
  return a;
}

function q(a) {
  if(typeof a === 'string' && a[0] !== '"')
    return ['"', a, '"'].join('');
  return a;
}

function lowercase(a) {
  if(typeof a === 'string')
    return a.toLowerCase();
  return a;
}

function kd() {
  var hash = crypto.createHash('md5');

  var a = Array.prototype.join.call(arguments, ':');
  hash.update(a);

  return hash.digest('hex');
}
exports.kd = kd;

function rbytes() {
  return kd(Math.random().toString(), Math.random().toString());
}

function calculateUserRealmPasswordHash(user, realm, password) {
  return kd(unq(user), unq(realm), unq(password));
}
exports.calculateUserRealmPasswordHash = calculateUserRealmPasswordHash;

function calculateHA1(ctx) {
  var userhash = ctx.userhash || calculateUserRealmPasswordHash(ctx.user, ctx.realm, ctx.password);
  if(ctx.algorithm === 'md5-sess') return kd(userhash, ctx.nonce, ctx.cnonce);

  return userhash; 
}
exports.calculateHA1 = calculateHA1;

function calculateDigest(ctx) {
  switch(ctx.qop) {
  case 'auth-int':
    return kd(ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop, kd(ctx.method, ctx.uri, kd(ctx.entity)));
  case 'auth':
    return kd(ctx.ha1, ctx.nonce, ctx.nc, ctx.cnonce, ctx.qop, kd(ctx.method, ctx.uri));
  }

  return kd(ctx.ha1, ctx.nonce, kd(ctx.method, ctx.uri));
}
exports.calculateDigest = calculateDigest;

var nonceSalt = rbytes();
function generateNonce(tag, timestamp) {
  var ts = (timestamp || new Date()).toISOString();
  return new Buffer.from([ts, kd(ts, tag, nonceSalt)].join(';'), 'ascii').toString('base64');
}
exports.generateNonce = generateNonce;

function extractNonceTimestamp(nonce, tag) {
  var v = new Buffer.from(nonce, 'base64').toString('ascii').split(';');
  if(v.length != 2)
    return;

  var ts = new Date(v[0]);

  return generateNonce(tag, ts) === nonce && ts;
}
exports.extractNonceTimestamp = extractNonceTimestamp;

function numberTo8Hex(n) {
  n = n.toString(16);
  return '00000000'.substr(n.length) + n;
}

function findDigestRealm(headers, realm) {
  if(!realm) return headers && headers[0];
  return headers && headers.filter(function(x) { return x.scheme.toLowerCase() === 'digest' && unq(x.realm) === realm; })[0];
}

function selectQop(challenge, preference) {
  if(!challenge)
    return;

  challenge = unq(challenge).split(',');
  if(!preference)
    return challenge[0];

  if(typeof(preference) === 'string') 
    preference = preference.split(',');

  for(var i = 0; i !== preference.length; ++i)
    for(var j = 0; j !== challenge.length; ++j)
      if(challenge[j] === preference[i])
        return challenge[j];

  throw new Error('failed to negotiate protection quality');
}

exports.challenge = function(ctx, rs) {
  ctx.proxy = rs.status === 407;

  ctx.nonce = ctx.cnonce || rbytes();
  ctx.nc = 0;
  ctx.qop = ctx.qop || 'auth,auth-int';
  ctx.algorithm = ctx.algorithm || 'md5';


  var hname = ctx.proxy ? 'proxy-authenticate' : 'www-authenticate';
  (rs.headers[hname] || (rs.headers[hname]=[])).push(
    {
      scheme: 'Digest',
      realm: q(ctx.realm),
      qop: q(ctx.qop),
      algorithm: ctx.algorithm,
      nonce: q(ctx.nonce),
      opaque: q(ctx.opaque)
    }
  );

  return rs;
}

exports.authenticateRequest = function(ctx, rq, creds) {
  var response = findDigestRealm(rq.headers[ctx.proxy ? 'proxy-authorization': 'authorization'], ctx.realm);

  if(!response) return false;

  var cnonce = unq(response.cnonce);
  var uri = unq(response.uri);
  var qop = unq(lowercase(response.qop));

  ctx.nc = (ctx.nc || 0) +1;
  
  if(!ctx.ha1) {
    ctx.userhash = creds.hash || calculateUserRealmPasswordHash(creds.user, ctx.realm, creds.password);
    ctx.ha1 = ctx.userhash;
    if(ctx.algorithm === 'md5-sess')
      ctx.ha1 = kd(ctx.userhash, ctx.nonce, cnonce);
  }
  
  var digest = calculateDigest({ha1:ctx.ha1, method:rq.method, nonce:ctx.nonce, nc:numberTo8Hex(ctx.nc), cnonce:cnonce, qop:qop, uri:uri, entity:rq.content});
  if(digest === unq(response.response)) {
    ctx.cnonce = cnonce;
    ctx.uri = uri;
    ctx.qop = qop;

    return true;
  } 

  return false;
}

exports.signResponse = function(ctx, rs) {
  var nc = numberTo8Hex(ctx.nc);
  rs.headers['authentication-info'] = {
    qop: ctx.qop,
    cnonce: q(ctx.cnonce),
    nc: nc,
    rspauth: q(calculateDigest({ha1:ctx.ha1, method:'', nonce:ctx.nonce, nc:nc, cnonce:ctx.cnonce, qop:ctx.qop, uri:ctx.uri, entity:rs.content}))
  };
  return rs;
}

function initClientContext(ctx, rs, creds) {
  var challenge;

  if(rs.status === 407) {
    ctx.proxy = true;
    challenge = findDigestRealm(rs.headers['proxy-authenticate'], creds.realm);
  }
  else
    challenge = findDigestRealm(rs.headers['www-authenticate'], creds.realm);
  
  if(ctx.nonce !== unq(challenge.nonce)) {
    ctx.nonce = unq(challenge.nonce);

    ctx.algorithm = unq(lowercase(challenge.algorithm));
    ctx.qop = selectQop(lowercase(challenge.qop), ctx.qop);
 
    if(ctx.qop) {
      ctx.nc = 0;
      ctx.cnonce = rbytes();
    }

    ctx.realm = unq(challenge.realm);
    ctx.user = creds.user;
    ctx.userhash = creds.hash || calculateUserRealmPasswordHash(creds.user, ctx.realm, creds.password);
    ctx.ha1 = ctx.userhash;

    if(ctx.algorithm === 'md5-sess')
      ctx.ha1 = kd(ctx.ha1, ctx.nonce, ctx.cnonce);

    ctx.domain = unq(challenge.domain);
 }

  ctx.opaque = unq(challenge.opaque);
}

exports.signRequest = function (ctx, rq, rs, creds) {
  ctx = ctx || {};
  if(rs)
    initClientContext(ctx, rs, creds);

  var nc = ctx.nc !== undefined ? numberTo8Hex(++ctx.nc) : undefined;

  ctx.uri = stringifyUri(rq.uri);
  
  var signature = {
    scheme: 'Digest',
    realm: q(ctx.realm),
    username: q(ctx.user),
    nonce: q(ctx.nonce), 
    uri: q(ctx.uri),
    nc: nc,
    algorithm: ctx.algorithm,
    cnonce: q(ctx.cnonce),
    qop: ctx.qop,
    opaque: q(ctx.opaque),
    response: q(calculateDigest({ha1:ctx.ha1, method:rq.method, nonce:ctx.nonce, nc:nc, cnonce:ctx.cnonce, qop:ctx.qop, uri:ctx.uri, entity:rq.content}))    
  };

  var hname = ctx.proxy ? 'proxy-authorization' : 'authorization'; 
 
  rq.headers[hname] = (rq.headers[hname] || []).filter(function(x) { return unq(x.realm) !== ctx.realm; });
  rq.headers[hname].push(signature);

  return ctx.qop ? ctx : null;
}

exports.authenticateResponse = function(ctx, rs) {
  var signature = rs.headers[ctx.proxy ? 'proxy-authentication-info' : 'authentication-info'];

  if(!signature) return undefined;

  var digest=calculateDigest({ha1:ctx.ha1, method:'', nonce:ctx.nonce, nc:numberTo8Hex(ctx.nc), cnonce:ctx.cnonce, qop:ctx.qop, uri:ctx.uri, enity:rs.content});
  if(digest === unq(signature.rspauth)) {
    var nextnonce = unq(signature.nextnonce);
    if(nextnonce && nextnonce !== ctx.nonce) {
      ctx.nonce = nextnonce;
      ctx.nc = 0;

      if(ctx.algorithm === 'md5-sess') 
        ctx.ha1 = kd(ctx.userhash, ctx.nonce, ctx.cnonce);
    }

    return true;
  }
 
  return false;
}


