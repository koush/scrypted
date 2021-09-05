import { Duplex } from 'stream';
import Debug from 'debug';
import { EventEmitter } from 'events';
import process from 'process';
import axios from 'axios';
const { register, listen } = require('push-receiver');
const { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } = require('wrtc');

const debug = Debug('rtc');

function ab2str(buffer) {
  return Buffer.from(buffer).toString();
}

function str2ab(str) {
  const buffer = Buffer.from(str);
  return buffer.slice(0, buffer.byteLength);
}

interface ThrottleToken {
  items: any[];
  timeout: any;
}

function throttleTimeout(token: ThrottleToken, item, throttle, cb, immediate?): ThrottleToken {
  if (!token)
    token = { items: [], timeout: undefined };
  token.items.push(item);
  if (!token.timeout) {
    function onTimeout() {
      delete token.timeout;
      cb(token.items);
      token.items = [];
    }
    if (immediate)
      onTimeout();
    token.timeout = setTimeout(onTimeout, throttle);
  }
  return token;
}

function isNode() {
  return true;
}

export class GcmRtcSocket extends Duplex {
  conn: GcmRtcConnection;
  dc: RTCDataChannel;
  gotEof: boolean;
  choke: Promise<any>;
  chokeDeferred: any;
  needsBufferShim: boolean;
  bufferedAmountLow: any;
  _writing: boolean;
  _finalCallback: any;
  command: string;
  choking: boolean;

  // last byte of any sent message is transport status.
  // 0: no status
  // 1: eof
  // 2: choke
  // 3: resume
  constructor(conn, dc) {
    super();

    this.conn = conn;
    this.dc = dc;
    this.gotEof = false;

    dc.onmessage = (message) => {
      let buffer = Buffer.from(message.data);
      let code = buffer[buffer.byteLength - 1];;
      let eof = code === 1;
      let choke = code === 2;
      let resume = code === 3;
      let more = this.push(buffer.subarray(0, buffer.byteLength - 1));
      if (!more) {
        try {
          this.choking = true;
          dc.send(new Uint8Array([2]));
        }
        catch (e) {
          this.destroy(e);
          return;
        }
      }
      if (eof) {
        // debug('killing', dc.id)
        this.gotEof = true;
        this.push(null);
        // this.detach();
      }
      if (choke && !this.choke) {
        this.choke = new Promise((resolve, reject) => this.chokeDeferred = { resolve, reject });
      }
      if (resume) {
        this.chokeDeferred?.resolve();
      }
    };

    dc.onclose = () => this.destroy(new Error('closed'));
    dc.onerror = e => this.destroy(e);

    try {
      this.needsBufferShim = isNode() || parseInt(/Chrome\/(\d\d)/.exec(navigator.userAgent)[1]) < 70;
    }
    catch (ignored) {
    }

    if (!this.needsBufferShim) {
      dc.bufferedAmountLowThreshold = 0;
      dc.onbufferedamountlow = () => {
        const cb = this.bufferedAmountLow;
        this.bufferedAmountLow = undefined;
        cb?.();
      };
    }
  }

  _read() {
    try {
      if (this.choking) {
        this.choking = false;
        this.dc.send(new Uint8Array([3]));
      }
    }
    catch (e) {
      this.destroy(e);
    }
  }

  async _write(chunk, encoding, callback) {
    try {
      this._writing = true;

      if (this.choke) {
        await this.choke;
        delete this.choke;
      }

      const dc = this.dc;
      let offset = 0;
      while (offset < chunk.byteLength) {
        // 16k is the max size. undershooting it here.
        const need = Math.min(chunk.byteLength - offset, 8192 + 4096);
        const buffer = chunk.subarray(offset, offset + need);
        let packet = new Uint8Array(need + 1);
        packet.set(new Uint8Array(buffer));
        offset += need;

        dc.send(packet);
        if (dc.bufferedAmount === 0 || this.needsBufferShim)
          continue;

        await new Promise(resolve => this.bufferedAmountLow = resolve);
      }

      callback();
      this._finalCallback?.();
    }
    catch (e) {
      debug(e);
      callback(e);
      this._finalCallback?.(e);
    }
    finally {
      this._writing = false;
    }
  }

  _final(callback) {
    if (!this._writing) {
      this.detach();
      callback();
      return;
    }

    this._finalCallback = () => {
      this._finalCallback = undefined;
      this.detach();
      callback();
    };
  }

  detach() {
    if (!this.dc)
      return;

    let dc = this.dc;
    this.dc = undefined;
    dc.onclose = undefined;
    dc.onerror = undefined;
    if (dc.readyState === 'open') {
      try {
        // send EOF signal
        // this may fail if entire GCM Connection is being torn down or data channel died due to error
        dc.send(new Uint8Array([1]));

        // recycle
        if (this.gotEof)
          this.conn.recycleChannel(dc);
        else
          this.conn.waitForEof(dc);
      }
      catch (e) {
        // eat the potential send error, don't recycle
      }
    }
  }

  _destroy(err, callback) {
    if (this.dc == null) {
      callback();
      return;
    }

    this.detach();

    callback();
  }
}

export class GcmRtcConnection extends EventEmitter {
  peerConnection: RTCPeerConnection;
  manager: GcmRtcManager;
  key: string;
  inboundChannels: RTCDataChannel[];
  outboundChannels: RTCDataChannel[];
  sendConnect: any;
  streams: readonly MediaStream[];
  remoteDesc: RTCSessionDescription;

  constructor(manager, pc, key) {
    super();
    this.manager = manager;
    this.peerConnection = pc;
    this.key = key;

    this.peerConnection.onconnectionstatechange = () => {
      switch (this.peerConnection.connectionState) {
        case "disconnected":
        case "failed":
        case "closed":
          this.destroy();
      }
    };

    // monitor connection attempt failure
    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection.connectionState === 'connected')
        return;

      if (this.peerConnection.iceConnectionState == 'disconnected' || this.peerConnection.iceConnectionState == 'closed' || this.peerConnection.iceConnectionState == 'failed') {
        this.destroy();
      }
    }
  }

  waitForCommand(dc) {
    dc.onmessage = (message) => {
      // watch for dangling eof
      if (message.data.byteLength == 1)
        return;
      this.removeChannel(dc);
      let command = ab2str(message.data);
      let socket = new GcmRtcSocket(this, dc);
      socket.command = command;
      this.emit('socket', command, socket);
    };
  }
  compactChannels() {
    if (this.inboundChannels && !this.inboundChannels.length)
      this.inboundChannels = null;
    if (this.outboundChannels && !this.outboundChannels.length)
      this.outboundChannels = null;
  }
  getAppropriateChannels  (dc, create?) {
    // it's possible to have a race condition where both sides of this connection
    // try to use a recycled datachannel at the same time, thus causing a race condition.
    // so maintain inbound/outbound channel lists.
    // only outbound channels can be used to initiate an outgoing connection, and that's
    // the list they are created in and get recycled into.
    let channels;
    if (dc.inbound) {
      if (!this.inboundChannels && create)
        this.inboundChannels = []
      channels = this.inboundChannels;
    }
    else {
      if (!this.outboundChannels && create)
        this.outboundChannels = []
      channels = this.outboundChannels;
    }
    return channels
  }
  removeChannel  (dc) {
    let channels = this.getAppropriateChannels(dc);
    if (!channels)
      return;
    let i = channels.indexOf(dc);
    if (i == -1)
      return;
    channels.splice(i, 1);
    this.compactChannels();
  }
  waitForEof  (dc) {
    dc.onmessage = (message) => {
      let ui = new Uint8Array(message.data);
      let eof = ui[ui.byteLength - 1] == 1;
      if (eof)
        this.recycleChannel(dc);
    };
  }
  recycleChannel  (dc) {
    let channels = this.getAppropriateChannels(dc, true);
    channels.push(dc);
    dc.onclose = dc.onerror = () => {
      this.removeChannel(dc);
    };
    this.waitForCommand(dc);
  }
  addCandidates  (message) {
    for (let candidate in message.candidates) {
      debug('remote candidate', message.candidates[candidate]);
      this.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidates[candidate]));
    }
  }
  setupPinger(pinger) {
    let timeout;
    function ping() {
      pinger.send(str2ab('ping'));
      timeout = setTimeout(ping, 1000);
    }
    pinger.onmessage = (ignored) => {
    }
    pinger.onclose = pinger.onerror = () => {
      clearTimeout(timeout);
      this.destroy();
    };
    ping();
  }
  listenSockets() {
    this.peerConnection.ondatachannel = (ev) => {
      // debug('got dc ' + ev.channel.label, ev.channel.id, ev.channel.readyState)
      (ev.channel as any).inbound = true;
      this.waitForCommand(ev.channel);
    };
  }
  prepareChannel  (label) {
    let dc = this.peerConnection.createDataChannel(label || 'gcm', {
      ordered: true
    });
    dc.binaryType = 'arraybuffer';
    return dc;
  }
  async newSocket(command) {
    return new Promise(connectCallback => {
      if (this.peerConnection.signalingState == 'closed')
        throw new Error('rtc connection is closed');

      if (this.outboundChannels) {
        // debug('using recycled channel', label);
        let dc = this.outboundChannels.shift();
        this.compactChannels();
        dc.send(str2ab(command));
        let socket = new GcmRtcSocket(this, dc);
        socket.command = command;
        connectCallback(socket);
        return;
      }

      // debug('using new channel', label);
      let dc = this.prepareChannel('gcm');
      let hasOpened;
      dc.onopen = async () => {
        await new Promise(resolve => process.nextTick(resolve));
        // debug('connected', label, dc.id);

        // node-webrtc seems to have an issue not firing onopen
        // as the datachannel is immediately open?
        // let's just watch for double callbacks just in case.
        if (hasOpened)
          return;
        hasOpened = true;

        dc.send(str2ab(command));
        let socket = new GcmRtcSocket(this, dc);
        socket.command = command;
        connectCallback(socket);
      }
      if (dc.readyState == 'open')
        dc.onopen(null);
      // debug('socket status', dc.readyState);
    });
  }

  destroy() {
    debug('ending connection', this.key);
    delete this.manager.gcmRtcConnections[this.key];
    if (this.peerConnection.signalingState != 'closed') {
      this.peerConnection.close();
    }
    this.emit('close');
  }

}

export class GcmRtcManager extends EventEmitter {
  gcmRtcConnections: { [id: string]: GcmRtcConnection };
  senders: any;
  registrationId: any;
  rtcc: any;
  gcmRtcListeners: any;
  amazonTokens: any;
  clockwork: any;

  constructor(senders, registrationId, rtcc) {
    super();
    this.senders = senders;
    this.registrationId = registrationId;
    this.rtcc = rtcc;
    this.gcmRtcConnections = {};
    this.gcmRtcListeners = {};
    this.amazonTokens = {};
  }


  destroy() {
    this.clockwork?.destroy();
  }

  onMessage(data) {
    let message = JSON.parse(data.message);
    // debug('gcm message', message);
    let type = data.type;
    let senderId = data.senderId;
    let src = data.src;
    let srcPort = data.srcPort;
    let dst = data.dst || this.registrationId;
    let dstPort = data.dstPort;

    if (type == 'offer') {
      let listener = this.gcmRtcListeners[dstPort]
      if (!listener)
        debug('not listening on ' + dstPort);
      else
        listener.listener.incoming(senderId, src, srcPort, dst, dstPort, message, listener.listenCallback);
      return;
    }
    else if (type == 'answer') {
      let key = GcmRtcManager.getKey(src, srcPort, dstPort);
      let conn = this.gcmRtcConnections[key];
      if (!conn) {
        // debug('pending connection not found', key);
        // debug(data);
        return;
      }
      conn.manager.incoming(senderId, src, srcPort, dst, dstPort, message);
      return;
    }
    else if (GcmRtcManager.onUnknownMessage) {
      GcmRtcManager.onUnknownMessage(data);
    }
    else {
      debug('unknown message ' + type);
    }
  }

  static async start(senders, rtcc) {
    debug('starting GtcRtcManger');
    const self = new GcmRtcManager(senders, null, rtcc);

    const credentialsJson = localStorage.getItem('fcm');
    let credentials: any;
    try {
      if (!credentialsJson)
        throw new Error();
      credentials = JSON.parse(credentialsJson);
    }
    catch (e) {
      credentials = await register(Object.keys(senders)[0]);
      localStorage.setItem('fcm', JSON.stringify(credentials));
    }

    let persistentIds = [];
    try {
      persistentIds = JSON.parse(localStorage.getItem('persistentIds'));
    }
    catch (e) {
    }

    const backoff = Date.now();
    let client = await listen({ ...credentials, persistentIds: [] }, (notification: any) => {
      try {
        localStorage.setItem('persistentIds', JSON.stringify(client._persistentIds));
        // check timestamp/type instead?
        if (Date.now() < backoff + 5000)
          return;
        self.onMessage(notification.notification.data);
      }
      catch (e) {
        if (!self.emit('unhandled', notification.notification.data, e)) {
          console.error('unhandled message', notification.notification.data, e);
        }
      }
      // console.log(notification)
    });

    const registrationId = credentials.fcm.token;
    debug('registration', registrationId);
    self.registrationId = registrationId;

    return self;
  }

  wrapMessage(senderId, dst, dstPort, src, srcPort, type, message) {
    return {
      senderId: senderId,
      src: src,
      srcPort: srcPort,
      dst: dst,
      dstPort: dstPort,
      type: type,
      message: JSON.stringify(message)
    }
  }

  sendGcm(senderId, registrationId, dstPort, src, srcPort, type, message) {
    let wrappedMessage = this.wrapMessage(senderId, registrationId, dstPort, src, srcPort, type, message);
    return this.sendWrappedMessage(senderId, registrationId, wrappedMessage);
  }

  sendWrappedMessage(senderId, registrationId, wrappedMessage) {
    if (registrationId.startsWith('web:')) {
      return axios.post(registrationId.substring(4), wrappedMessage, {
        responseType: 'json',
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then(response => response.data);
    }
    else if (registrationId.startsWith('amzn')) {
      let tokenPromise;
      if (!this.amazonTokens[senderId] || this.amazonTokens[senderId].accessTokenExpiration < Date.now()) {
        let secret = this.senders[senderId];
        debug(senderId, secret);
        let params = {
          'grant_type': 'client_credentials',
          'scope': 'messaging:push',
          'client_id': senderId,
          'client_secret': secret,
        };
        let encoded = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

        tokenPromise = axios.post('https://api.amazon.com/auth/O2/token', encoded, {
          responseType: 'json',
          headers: {
            'Content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
        })
          .then(response => response.data)
          .then(tokenInfo => {
            this.amazonTokens[senderId] = {};
            this.amazonTokens[senderId].accessToken = tokenInfo.access_token;
            this.amazonTokens[senderId].accessTokenExpiration = Date.now() + tokenInfo.expires_in - 30;

            return tokenInfo.access_token;
          })
      }
      else {
        debug('token valid for', this.amazonTokens[senderId].accessTokenExpiration - Date.now());
        tokenPromise = Promise.resolve(this.amazonTokens[senderId].accessToken);
      }

      return tokenPromise.then(accessToken => {
        return axios.post(`https://api.amazon.com/messaging/registrations/${registrationId}/messages`, {
          data: wrappedMessage,
        },
          {
            responseType: 'json',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'X-Amzn-Type-Version': 'com.amazon.device.messaging.ADMMessage@1.0',
              'X-Amzn-Accept-Type': 'com.amazon.device.messaging.ADMSendResult@1.0',
            },
          })
          .then(response => response.data);
      });
    }
    else {
      return axios.post("https://fcm.googleapis.com/fcm/send", {
        to: registrationId,
        data: wrappedMessage
      },
        {
          responseType: 'json',
          headers: {
            "Content-Type": "application/json",
            "Authorization": "key=" + this.senders[senderId]
          },
        })
        .then(response => response.data)
    }
  }


  setupPeerConnection(type, senderId, registrationId, dstPort, src, srcPort, getDesc) {
    let pc = new RTCPeerConnection(this.rtcc);
    let token;
    let sendConnect = (candidates) => {
      let portion = [];

      let desc = getDesc();
      let sdp = desc.sdp;
      let compressedDesc = {
        type: desc.type,
        sdp: GcmRtcManager.compressSdp(desc.sdp),
      }
      let descLen = JSON.stringify(compressedDesc).length;

      // gaurantee that the desc is sent at least once.
      let sentOnce;
      for (let candidate in candidates) {
        candidate = candidates[candidate];
        if (candidate == null)
          continue;
        portion.push(candidate);
        if (descLen + JSON.stringify(portion).length > 3200) {
          sentOnce = true;
          this.sendGcm(senderId, registrationId, dstPort, src, srcPort, type,
            {
              desc: compressedDesc,
              candidates: portion
            });
          portion = [];
        }
      }

      if (portion.length > 0 || !sentOnce) {
        this.sendGcm(senderId, registrationId, dstPort, src, srcPort, type,
          {
            desc: compressedDesc,
            candidates: portion
          });
      }
    };

    pc.onicecandidate = (evt) => {
      // uncomment to force TURN
      // if (evt.candidate.candidate.indexOf('relay') == -1)
      //   return;
      if (evt.candidate) {
        debug('candidate', evt.candidate);
        token = throttleTimeout(token, evt.candidate, 500, sendConnect);
      }
      else {
        debug('done sending ice candidates');
      }
    };

    let key = GcmRtcManager.getKey(registrationId, dstPort, srcPort);
    let conn = new GcmRtcConnection(this, pc, key);
    conn.sendConnect = sendConnect;

    pc.onsignalingstatechange = (ev) => {
      // debug('pcs', pc.signalingState)
      if (pc.signalingState == 'stable') {
        if (this.gcmRtcConnections[key] == conn) {
          // keep allowing ice candidates?
          // delete this.gcmRtcConnections[key];
        }
      }
      else if (pc.signalingState == 'closed') {
        conn.destroy();
      }
    };

    debug('connecting to', key);
    this.gcmRtcConnections[key] = conn;
    return conn;
  }

  connect(options) {
    return new Promise((resolve, reject) => {

      let senderId = options.senderId;
      let registrationId = options.registrationId;
      let port = options.port;

      if (!registrationId) {
        throw new Error('registrationId was null on connect');
      }

      // ports can be any old random string
      let localPort = Math.random().toString(16);
      let d;
      let conn = this.setupPeerConnection('offer', senderId, registrationId, port, this.registrationId, localPort, function () {
        return d;
      });
      let pc = conn.peerConnection;
      try {
        if (navigator.userAgent.indexOf('Safari') != -1 && navigator.userAgent.indexOf('Chrome') == -1 && options.offerToReceiveAudio && options.offerToReceiveVideo) {
          pc.addTransceiver('audio');
          pc.addTransceiver('video');
        }
      }
      catch (e) {
      }

      let failureTimeout = setTimeout(function () {
        conn.destroy();
        reject(new Error('Timeout waiting for RTC Connection'));
      }, 30000);

      function doOffer(options) {
        pc.createOffer(options).then(function (desc) {
          d = desc;
          debug(desc);
          pc.setLocalDescription(desc);
          // force the desc to be sent. safari doesn't trigger onicecandidate on receive only?
          conn.sendConnect([]);
        });
      }

      if (options.offerToReceiveAudio || options.offerToReceiveVideo || options.audio) {
        function internal() {
          pc.ontrack = (e) => {
            conn.streams = e.streams;
            debug('got the remote stream');
            clearTimeout(failureTimeout);
            resolve(conn);
          }
          doOffer({
            offerToReceiveAudio: !!options.offerToReceiveAudio,
            offerToReceiveVideo: !!options.offerToReceiveVideo,
            voiceActivityDetection: false
          });
        }

        if (!options.audio) {
          internal();
          return;
        }

        navigator.mediaDevices.getUserMedia({ "audio": true })
          .then(function (stream) {
            stream.getTracks().forEach(function (track) {
              pc.addTrack(track, stream);
            });
            internal();
          })
          .catch(e => {
            debug('audio fail', e);
            internal();
          });
      }
      else {
        let pinger = conn.prepareChannel('pinger');
        pinger.onopen = () => {
          debug('got rtc pinger')
          conn.setupPinger(pinger);
          clearTimeout(failureTimeout);
          resolve(conn);
        }
        conn.listenSockets();
        doOffer({});
      }

    });
  }

  isListening(port) {
    return this.gcmRtcListeners[port] != null;
  }
  stopListen(port) {
    delete this.gcmRtcListeners[port];
  }

  listen(port, cb) {
    if (this.gcmRtcListeners[port]) {
      debug('already listening on gcm port ' + port)
      return;
    }
    this.gcmRtcListeners[port] = {
      listener: this,
      listenCallback: cb
    };
  }

  incoming(senderId, src, srcPort, dst, dstPort, message, listenCallback?) {
    let key = GcmRtcManager.getKey(src, srcPort, dstPort);
    let conn = this.gcmRtcConnections[key];
    if (!conn) {
      if (!src) {
        debug('received null registraition on incoming message. ignoring');
        return;
      }

      // new connection
      let d;
      conn = this.setupPeerConnection('answer', senderId, src, srcPort, dst, dstPort, function () {
        return d;
      });
      let sdp = message.desc.sdp;
      message.desc.sdp = GcmRtcManager.decompressSdp(sdp);
      conn.remoteDesc = new RTCSessionDescription(message.desc);
      let pc = conn.peerConnection;
      pc.ondatachannel = (ev) => {
        debug('got rtc pinger')
        conn.setupPinger(ev.channel);
        listenCallback(conn);
        conn.listenSockets();
      };
      pc.setRemoteDescription(conn.remoteDesc).then(() => {
        pc.createAnswer()
          .then(function (answer) {
            d = answer;
            pc.setLocalDescription(answer);
          }, function () {
            debug('answer error', arguments);
          })
      });
    }
    else if (!conn.remoteDesc) {
      let sdp = message.desc.sdp;
      message.desc.sdp = GcmRtcManager.decompressSdp(sdp);
      conn.remoteDesc = new RTCSessionDescription(message.desc);
      let pc = conn.peerConnection;
      pc.setRemoteDescription(conn.remoteDesc);
    }
    else {
      // debug('more ice candidates received')
    }

    conn.addCandidates(message);
  }


  static getKey(registrationId, dstPort, srcPort) {
    return srcPort + ':' + dstPort + ':' + registrationId;
  }
  
  static dictionaryKeys = "0 1 2 3 4 5 6 7 8 9 a b c d e f g h i j k l m n o p q r s t u v w x y z".split(" ");
  static sdpDictionary = {};
  static addDictionary  (token) {
    let curKey = GcmRtcManager.dictionaryKeys[Object.keys(GcmRtcManager.sdpDictionary).length];
    GcmRtcManager.sdpDictionary[curKey] = token;
  }
  static replaceAll  (str, replaceWhat, replaceTo) {
    replaceWhat = replaceWhat.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    let re = new RegExp(replaceWhat, 'g');
    return str.replace(re, replaceTo);
  }
  static compressSdp  (sdp) {
    sdp = sdp.replace('\\', '\\\\');
    for (let key in GcmRtcManager.sdpDictionary) {
      let val = GcmRtcManager.sdpDictionary[key];
      sdp = GcmRtcManager.replaceAll(sdp, val, '\\' + key);
    }
    return sdp;
  };
  static decompressSdp  (sdp) {
    for (let key in GcmRtcManager.sdpDictionary) {
      let val = GcmRtcManager.sdpDictionary[key];
      sdp = sdp.replace(new RegExp(`([^\\\\])\\\\${key}`, 'g'), "$1" + val);
      // sdp = sdp.replace(new RegExp("^(\\\\${key})", 'g'))
    }
    return sdp;
  };

  static onUnknownMessage(data: any) {

  }
}


(function () {
  let ad = GcmRtcManager.addDictionary;

  ad("a=rtpmap:");
  ad("a=extmap:");
  ad("a=rtcp-fb:");
  ad("a=fmtp:");
  ad("level-asymmetry-allowed=");
  ad("packetization-mode=");
  ad("profile-level-id=");
  ad("90000");
  ad("rtx/90000");
  ad("H264/90000")
  ad("transport-cc");
  ad("x-google-profile-id");
  ad("nack pli");
  ad("goog-remb");
  ad("ccm fir");
  ad("telephone-event/");
  ad("http://www.webrtc.org/experiments/rtp-hdrext/");
  ad("urn:ietf:params:rtp-hdrext:toffset");
  ad("http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time");
  ad("urn:3gpp:video-orientation");
  ad("http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01")
  ad("http://www.webrtc.org/experiments/rtp-hdrext/playout-delay")
  ad("http://www.webrtc.org/experiments/rtp-hdrext/video-content-type")
  ad("http://www.webrtc.org/experiments/rtp-hdrext/video-timing")
  ad("http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01")
})();
