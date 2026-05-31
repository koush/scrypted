import sip from "./sip/sip";
import digest from "./sip/digest";
import { localServiceIpAddress, rString, udpSocketType, unq } from './utils';
import { isV4Format } from 'ip';
import dgram from 'node:dgram';
import { timeoutPromise } from "@scrypted/common/src/promise-utils";
import { parseSdp } from '@scrypted/common/src/sdp-utils';

export interface SipAudioTarget {
    ip: string;
    port: number;
}

enum DialogStatus 
{
  Idle,
  // Incoming call states
  Ringing,
  Answer,
  Bye,
  ByeOk,
  // Outgoing call states
  Inviting,
  InviteAc,
  // Connected states (in/out)
  Connected,
  // Registration
  Regitering
}

interface SipState
{
  status: DialogStatus;
  msg?: any;
  waitAck?: Function;
}

const waitResponseTimeout = 5000; // in miliseconds
const clientRegistrationExpires = 3600; // in seconds

export interface SipRegistration
{
  user: string; // username for registration
  password: string; // password for registration
  ip: string; // ip address for registration or doorbell ip
  port: number; // port for registration or doorbell port
  callId: string; // call id for registration (local phone number)
  realm?: string; // realm for registration
  doorbellId: string; // doorbell id for registration (remote phone number)
}

export class SipManager {

  localIp: string;
  localPort: number;
  remoteAudioTarget?: SipAudioTarget;
  audioCodec?: string;

  private onInviteHandler?: () => void;
  private onStopRingingHandler?: () => void;
  private onHangupHandler?: () => void;
  
  private callId: string = '10012';

  constructor(private ip: string, private console: Console, private storage: Storage) {
  }

  setOnInviteHandler (handler: () => void)
  {
    this.onInviteHandler = handler;
  }

  setOnStopRingingHandler (handler: () => void)
  {
    this.onStopRingingHandler = handler;
  }

  setOnHangupHandler (handler: () => void)
  {
    this.onHangupHandler = handler;
  }

  private parseSdpAudioTarget (sdpContent?: string): SipAudioTarget | undefined
  {
    if (!sdpContent) return undefined;

    try {
      const parsed = parseSdp (sdpContent);
      
      // Find audio section
      const audioSection = parsed.msections.find (s => s.type === 'audio');
      if (!audioSection) {
        this.console.warn ('No audio section found in SDP');
        return undefined;
      }

      // Extract IP from header (c=IN IP4 ...)
      const cLine = parsed.header.lines.find (l => l.startsWith ('c='));
      const ipMatch = cLine?.match (/c=IN IP[46] ([\d.:a-fA-F]+)/);
      const ip = ipMatch?.[1];

      const port = audioSection.port;

      if (ip && port) {
        this.console.debug (`Parsed SDP audio target: ${ip}:${port}`);
        return { ip, port };
      }
    } catch (e) {
      this.console.error (`Failed to parse SDP: ${e}`);
    }

    return undefined;
  }

  async startClient (creds: SipRegistration)
  {
    this.clientMode = true;

    this.stop();
    await this.startServer();
    this.remoteCreds = creds;

    return this.register();
  }

  async startGateway (callId?: string, port?: number) 
  {
    if (this.clientMode && sip.stop) {
      await this.unregister();
    }

    this.clientMode = false;

    this.stop();
    if (port) {
      this.localPort = port;
    }
    if (callId) {
      this.callId = callId;
    }
    return this.startServer (!port);
  }

  stop() {
    sip.stop && sip.stop();
    this.clearState();
  }

  async answer()
  {
    if (this.state.status === DialogStatus.Ringing) 
    {
      const ring = this.state.msg;

      let rs = this.makeRs (ring, 200, 'Ok');

      rs.content = this.fakeSdpContent();
      rs.headers['Content-Type'] = 'application/sdp';
      
      try {
        await timeoutPromise<void> (waitResponseTimeout, new Promise<void> (resolve => { 
          this.setState ({
            status: DialogStatus.Answer,
            msg: ring,
            waitAck: resolve
          });
          sip.send (rs);
        }));
      } catch (error) {
        this.console.error (`Wait Ack error: ${error}`);
      }
      // await Promise.race ([waitAck, awaitTimeout (waitResponseTimeout)]);

      this.setState ({
        status: DialogStatus.Connected,
        msg: ring
      });
    }
  }

  async invite(): Promise<boolean>
  {
    if (this.state.status !== DialogStatus.Idle) {
      this.console.warn ('Cannot send INVITE: dialog not idle');
      return false;
    }

    if (!this.remoteCreds) {
      this.console.error ('Cannot send INVITE: no remote credentials');
      return false;
    }

    const creds = this.remoteCreds;
    const fromUri = sip.parseUri (`sip:${creds.callId}@${this.localIp}:${this.localPort}`);
    const toUri = sip.parseUri (`sip:${creds.doorbellId}@${creds.ip}:${creds.port}`);

    const inviteMsg = {
      method: 'INVITE',
      uri: toUri,
      headers: {
        to: { uri: toUri },
        from: { uri: fromUri, params: { tag: rString() } },
        'call-id': `${rString()}@${this.localIp}:${this.localPort}`,
        cseq: { seq: 1, method: 'INVITE' },
        contact: [{ uri: fromUri }],
        'content-type': 'application/sdp',
      },
      content: this.fakeSdpContent()
    };

    this.setState ({
      status: DialogStatus.Inviting,
      msg: inviteMsg
    });

    try {
      // Send INVITE and collect all responses until final (200 or 4xx/5xx/6xx)
      const response = await timeoutPromise<any> (waitResponseTimeout * 3, new Promise<any> ((resolve, reject) => {
        sip.send (inviteMsg, (rs) => {
          if (rs.status >= 100 && rs.status < 200) {
            // Provisional response (100 Trying, 180 Ringing)
            this.console.debug (`INVITE: Provisional response ${rs.status}`);
            // Don't resolve, callback will be called again for final response
          } else if (rs.status >= 200) {
            // Final response (200 OK or error)
            resolve (rs);
          }
        });
      }));

      if (response.status === 200) 
      {
        this.console.info ('INVITE: Call accepted (200 OK)');
        
        // Parse remote SDP
        this.remoteAudioTarget = this.parseSdpAudioTarget (response.content);
        
        this.setState ({
          status: DialogStatus.InviteAc,
          msg: response
        });

        // Send ACK
        const ackMsg = {
          method: 'ACK',
          uri: toUri,
          headers: {
            to: response.headers.to,
            from: inviteMsg.headers.from,
            'call-id': inviteMsg.headers['call-id'],
            cseq: { seq: 1, method: 'ACK' },
            contact: inviteMsg.headers.contact,
          }
        };

        sip.send (ackMsg);

        this.setState ({
          status: DialogStatus.Connected,
          msg: response
        });

        return true;
      } 
      else if (response.status >= 400) 
      {
        this.console.error (`INVITE failed: ${response.status} ${response.reason}`);
        this.clearState();
        return false;
      }
    } 
    catch (error) {
      this.console.error (`INVITE error: ${error}`);
      this.clearState();
      return false;
    }

    this.clearState();
    return false;
  }

  async hangup(): Promise<boolean>
  {
    if (this.state.status !== DialogStatus.Connected) {
      this.console.warn ('Cannot send BYE: dialog not connected');
      return false;
    }

    const byeMsg = this.bye (this.state.msg);

    try 
    {
       const doit = new Promise<boolean> (resolve => {

        sip.send (byeMsg, (rs) => {
          this.console.info (`BYE response:\n${sip.stringify (rs)}`);
          if (rs.status == 200) {
            this.setState ({ status: DialogStatus.ByeOk, msg: byeMsg });
            resolve (true);
          }
        });
        this.setState ({ status: DialogStatus.Connected, msg: byeMsg });

      });

      var result = await timeoutPromise<boolean> (waitResponseTimeout, doit);
    } catch (error) {
      this.console.error (`Wait OK error: ${error}`);
      return false;
    }

    // const result = await Promise.race ([waitOk, awaitTimeout(waitResponseTimeout).then (()=> false)])
    if (!result) {
      this.console.error (`When BYE, timeout occurred`);
      return false;
    }

    this.clearState();
    return true;
  }

  private state: SipState = { status: DialogStatus.Idle};
  private clientMode: boolean = false;
  private authCtx: any = { nc: 1 };
  private registrationExpires: number = clientRegistrationExpires;
  private remoteCreds: SipRegistration;

  private setState (newState: SipState)
  {
    const oldStatus = this.state.status;
    const newStatus = newState.status;
    
    this.state = newState;
    
    // Hook for future actions on state transitions
    this.onStateChange (oldStatus, newStatus);
  }

  private onStateChange(oldStatus: DialogStatus, newStatus: DialogStatus) 
  {
    if (oldStatus === newStatus)
      return;

    this.console.debug (`State transition: ${DialogStatus[oldStatus]} -> ${DialogStatus[newStatus]}`);

    switch (oldStatus) 
    {
      case DialogStatus.Ringing:
        if (this.onStopRingingHandler) {
          // Call handler asynchronously to avoid blocking SIP message flow
          setImmediate (() => {
            try {
              this.onStopRingingHandler();
            } catch (e) {
              this.console.error(`Error in onStopRinging handler: ${e}`);
            }
          });
        }
        return;
    }

    switch (newStatus) 
    {

      case DialogStatus.Ringing:
        if (this.onInviteHandler) {
          // Call handler asynchronously to avoid blocking SIP message flow
          setImmediate (() => {
            try {
              this.onInviteHandler();
            } catch (e) {
              this.console.error(`Error in onInvite handler: ${e}`);
            }
          });
        }
        return;

      case DialogStatus.Bye:
        if (this.onHangupHandler) {
          // Call handler asynchronously to avoid blocking SIP message flow
          setImmediate (() => {
            try {
              this.onHangupHandler();
            } catch (e) {
              this.console.error(`Error in onHangup handler: ${e}`);
            }
          });
        }
        return;
    }
  }


  private incomeRegister (rq: any): boolean
  {
    // Parse registration request to extract credentials
    const fromUri = sip.parseUri (rq.headers.from.uri);
    const contactUri = rq.headers.contact && rq.headers.contact[0] && sip.parseUri (rq.headers.contact[0].uri);
    const toUri = sip.parseUri (rq.headers.to.uri);
    
    const user = fromUri.user || toUri.user; // username for registration
    const doorbellId = toUri.user || fromUri.user; // remote phone number (doorbell extension)
    const ip = contactUri?.host || fromUri.host;
    const port = contactUri?.port || fromUri.port || 5060;
    
    if (!user || !ip || !doorbellId) {
      this.console.warn ('REGISTER: Missing user, doorbellId or IP in request');
      return false;
    }
    
    // Store registration (only one client supported in gateway mode)
    this.remoteCreds = {
      user,
      password: '', // Password will be handled via digest auth if needed
      ip,
      port,
      callId: this.callId,
      doorbellId,
      realm: undefined
    };
    
    this.console.debug (`REGISTER: Stored registration for user ${user} from ${ip}:${port}`);
    
    let rs = sip.makeResponse (rq, 200, 'OK');
    rs.headers.contact = rq.headers.contact;
    rs.headers.expires = rq.headers.expires || clientRegistrationExpires;
    sip.send (rs);
    
    return true;
  }

  private async startServer (findFreePort: boolean = true) 
  {
    this.localIp = await localServiceIpAddress (this.ip);
    this.localPort = this.localPort ?? await this.getFreeUdpPort (this.localIp, udpSocketType (this.localIp));

    for (let times = 3; times; times--) 
    {
      try 
      {

        await sip.start({
          logger: { 
            send: (message, addrInfo) => {  
              this.console.debug (`send to ${addrInfo.address}:\n${sip.stringify(message)}`); 
            },
            recv: (message, addrInfo) => {  
              this.console.debug (`recv to ${addrInfo.address}:\n${sip.stringify(message)}`); 
            }
          },
          address: this.localIp,
          port: this.localPort,
          tcp: false
        },
        (rq, remote) => {
          try 
          {
            if (this.checkAuth (rq, remote)) 
            { 
              let result = false;
              if(rq.method === 'REGISTER') {  
                result = this.incomeRegister(rq);
              }
              else if(rq.method === 'INVITE') {
                result = this.incomeInvate(rq);
              }
              else if (rq.method == 'ACK') {
                result = this.incomeAck (rq);
              }
              else if (rq.method == 'CANCEL') {
                result = this.incomeCancel (rq);
              }
              else if (rq.method == 'BYE') {
                result = this.incomeBye (rq);
              }
              else {
                sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));
                result = true;
              }
    
              if (!result) {
                sip.send(sip.makeResponse(rq, 400, 'Bad Request'));
              }
              return;
            }
            sip.send (sip.makeResponse (rq, 403, 'Forbidden'));
          } 
          catch(e) 
          {
            this.console.error(e);
            this.console.error(e.stack);
            
            this.clearState();
            sip.send(sip.makeResponse(rq, 500, "Server Internal Error"));
          }
        });
        
        break; // exit from loop if success

      } 
      catch (error) {
        this.console.error (`Starting server error (attempts ${times}): ${error}`);
        // changing server port
        if (findFreePort) {
          this.localPort = await this.getFreeUdpPort (this.localIp, udpSocketType (this.localIp));
        }
      }
    }
  }

  private incomeInvate(rq: any): boolean 
  { 
    if (this.state.status === DialogStatus.Idle)
    {
      // Parse SDP to extract audio target
      this.remoteAudioTarget = this.parseSdpAudioTarget (rq.content);
      
      rq.headers.to = {uri: rq.headers.to.uri, params: { tag: 'govno' }};
      
      // Send 180 Ringing FIRST, before changing state
      let rs = this.makeRs(rq, 180, 'Ringing');
      sip.send(rs);
      
      // Then update state (this will trigger onInviteHandler asynchronously)
      this.setState ({
        status: DialogStatus.Ringing,
        msg: rq
      });
      
      return true;
    }
    return false;
  }

  private incomeAck (rq: any): boolean 
  {
    if (this.state.status == DialogStatus.Answer) {
      this.state.waitAck && this.state.waitAck();
      return true;
    }
    return false;
  }

  private incomeCancel (rq: any): boolean 
  {
    if (this.state.status == DialogStatus.Ringing ||
        this.state.status == DialogStatus.Answer) 
    {
      this.clearState();
      sip.send (this.makeRs (rq, 200, 'OK'));
      return true;
    }
    return false;
  }

  private incomeBye (rq: any): boolean 
  {
    if (this.state.status == DialogStatus.Connected ||
        this.state.status == DialogStatus.Bye) 
    {
      this.setState ({ status: DialogStatus.Bye, msg: rq });
      sip.send (this.makeRs (rq, 200, 'OK'));
      this.clearState();
      return true;
    }
    return false;
  }

  private makeRs (rq: any, status: number, reason?: string)
  {
    let rs = sip.makeResponse(rq, status, ...[reason]);
    const toUser = sip.parseUri(rq.headers.to.uri).user;
    rs.headers.contact = `sip:${toUser}@${this.localIp}:${this.localPort}`;
    return rs;
  }

  private bye (rq: any): any
  {
    let uri = rq.headers.contact[0] && rq.headers.contact[0].uri;
    if (uri === undefined) {
      uri = rq.headers.from.uri;
    }

    // In SIP dialog, BYE From/To depend on who initiated the call
    // If we received INVITE (server mode): swap headers
    // If we sent INVITE (client mode): keep headers as is
    const isServerMode = rq.method === 'INVITE';
    
    let msg = {
      method: 'BYE',
      uri: uri,
      headers: {
        to: isServerMode ? rq.headers.from : rq.headers.to,
        from: isServerMode ? rq.headers.to : rq.headers.from,
        'call-id': rq.headers['call-id'],
        cseq: {method: 'BYE', seq: rq.headers.cseq.seq + 1},
        contact: `sip:${this.callId}@${this.localIp}:${this.localPort}` 
      }
    }

    if (this.authCtx.realm) 
    {
      digest.signRequest (this.authCtx, msg);
      msg.headers.cseq.seq = this.authCtx.nc;
    }

    return msg;
  }

  private fakeSdpContent()
  {
    const ipv = isV4Format (this.localIp) ? 'IP4' : 'IP6';
    const ip = `${ipv} ${this.localIp}`;
    
    // Determine codec payload type and name
    let payloadType = '0';
    let codecName = 'PCMU/8000';
    
    if (this.audioCodec === 'pcm_alaw' || this.audioCodec === 'alaw') {
      payloadType = '8';
      codecName = 'PCMA/8000';
    } else if (this.audioCodec === 'pcm_mulaw' || this.audioCodec === 'mulaw') {
      payloadType = '0';
      codecName = 'PCMU/8000';
    }
    
    return 'v=0\r\n' +
    `o=yate 1707679323 1707679323 IN ${ip}\r\n` +
    's=SIP Call\r\n' +
    `c=IN ${ip}\r\n` +
    't=0 0\r\n' +
    `m=audio 9654 RTP/AVP ${payloadType} 101\r\n` +
    `a=rtpmap:${payloadType} ${codecName}\r\n` +
    'a=rtpmap:101 telephone-event/8000\r\n' +
    'a=sendonly\r\n' +
    'm=video 0 RTP/AVP 96\r\n' +
    'a=inactive\r\n';
  }

  private async getFreeUdpPort (ip: string, type: dgram.SocketType)
  {
    return new Promise<number> (resolve => {

      const socket = dgram.createSocket (type);
      socket.bind (0, ()=> {

        const result = socket.address().port;
        socket.close();
        resolve (result);
      });
    });
  }
  private async register (): Promise<boolean> 
  {
    return this.registerFlow (clientRegistrationExpires);
  }

  private async unregister (): Promise<boolean> 
  {
    return this.registerFlow (0);
  }

  private async registerFlow (expires: number): Promise<boolean> 
  {
    if (this.state.status !== DialogStatus.Idle) return false;

    const creds = this.remoteCreds;
    const hereUri = sip.parseUri (`sip:${creds.callId}@${this.localIp}:${this.localPort}`);

    const initMsg = {
      method: 'REGISTER', 
      uri: sip.parseUri (`sip:${creds.ip}:${creds.port}`),
      headers: {
        contact: [{ uri: hereUri }],
        expires: expires,
        to: { uri: sip.parseUri (`sip:${creds.callId}@${creds.ip}:${creds.port}`) },
        from: { uri: hereUri, params: { tag: rString() } },
        'call-id': `${rString()}@${creds.ip}:${creds.port}`,
        allow: 'ACK, INVITE, BYE, CANCEL',
        cseq: { seq: 1, method: 'REGISTER' }
      }
    }  

    this.setState ({
      status: DialogStatus.Regitering,
      msg: {...initMsg}
    });

    if (this.authCtx.realm) {
      digest.signRequest (this.authCtx, initMsg);
      initMsg.headers.cseq.seq = this.authCtx.nc;
    }

    let rs = await new Promise<any> (resolve => {
      sip.send (initMsg, (rs) => resolve (rs));
    });
    
    if (rs.status === 401) 
    {
      creds.realm = unq (rs.headers['www-authenticate'][0].realm);
      digest.signRequest (this.authCtx, initMsg, rs, creds);
      rs = await new Promise<any> (resolve => {
        sip.send (initMsg, (rs) => resolve (rs));
      });
    }

    this.clearState();

    if (rs.status === 200)
    {
      this.registrationExpires = rs.headers.expires || clientRegistrationExpires;
      const contact = rs.headers.contact[0];
      let exp = contact && contact.params.expires;
      if (exp) {
        this.registrationExpires = exp;
        this.scheduleRegister();
      }
      return true;
    }

    return false;
  }

  private scheduleRegister()
  {

  }

  private clearState()
  {
    this.setState ({ status: DialogStatus.Idle });
  }

  /// Simple check that request came from doorbell
  private checkAuth (rq: any, remote: any)
  {
    if (this.clientMode)
    {
      const uri = ( rq.headers.contact && rq.headers.contact[0].uri) || (rq.headers.from && rq.headers.from.uri);
      const puri = sip.parseUri (uri);
      const ip = puri && puri.host;
      if (ip) {
        return this.remoteCreds.ip === ip || this.ip === ip;
      }
    }

    return this.ip === remote.address;
  }
}
