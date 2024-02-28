import sip from "./sip/sip";
import digest from "./sip/digest";
import { localServiceIpAddress, rString, udpSocketType, unq } from './utils';
import { isV4Format } from 'ip';
import dgram from 'node:dgram';
import { timeoutPromise } from "@scrypted/common/src/promise-utils";



enum DialogStatus 
{
  Idle,
  Ringing,
  Answer,
  AnswerAc,
  Hangup,
  HangupAc,
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
  user: string;
  password: string;
  ip: string;
  port: number;
  callId: string;
  realm?: string;
}

export class SipManager {

  localIp: string;
  localPort: number;

  constructor(private ip: string, private console: Console, private storage: Storage) {
  }

  async startClient (creds: SipRegistration)
  {
    this.clientMode = true;

    this.stop();
    await this.startServer();

    this.clientCreds = creds;
    // {
    //   user: '4442',
    //   password: '4443',
    //   ip: '10.210.210.150',
    //   port: 5060,
    //   callId: '4442'
    // }

    return this.register();
  }

  async startGateway (port?: number) 
  {
    if (this.clientMode && sip.stop) {
      await this.unregister();
    }

    this.clientMode = false;

    this.stop();
    if (port) {
      this.localPort = port;
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

      let bye = true;
      let rs = this.makeRs (ring, 200, 'Ok');

      rs.content = this.fakeSdpContent();
      rs.headers['Content-Type'] = 'application/sdp';
      
      try {
        await timeoutPromise<void> (waitResponseTimeout, new Promise<void> (resolve => { 
          this.state = {
            status: DialogStatus.Answer,
            msg: ring,
            waitAck: resolve
          }
          sip.send (rs);
        }));
      } catch (error) {
        this.console.error (`Wait Ack error: ${error}`);
      }
      // await Promise.race ([waitAck, awaitTimeout (waitResponseTimeout)]);

      this.state = {
        status: DialogStatus.AnswerAc,
        msg: ring
      }
      const byeMsg = this.bye (ring);

      try 
      {
         const doit = new Promise<boolean> (resolve => {

          sip.send (byeMsg, (rs) => {
            this.console.log (`BYE response:\n${sip.stringify (rs)}`);
            if (rs.status == 200) {
              this.state.status = DialogStatus.HangupAc;
              resolve(true);
            }
          });
          this.state.status = DialogStatus.Hangup;
  
        });

        var result = await timeoutPromise<boolean> (waitResponseTimeout, doit);
      } catch (error) {
        this.console.error (`Wait OK error: ${error}`);
      }

      // const result = await Promise.race ([waitOk, awaitTimeout(waitResponseTimeout).then (()=> false)])
      if (!result) {
        this.console.error (`When BYE, timeut occurred`);
      }

      this.clearState();
    }
  }

  private state: SipState = { status: DialogStatus.Idle};
  private clientMode: boolean = false;
  private authCtx: any = { nc: 1 };
  private registrationExpires: number = clientRegistrationExpires;
  private clientCreds: SipRegistration;


  private incomeRegister(rq: any): boolean {

    let rs = sip.makeResponse(rq, 200, 'OK');
    rs.headers.contact = rq.headers.contact;
    sip.send(rs);

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
              this.console.log(`send to ${addrInfo.address}:\n${sip.stringify(message)}`); 
            },
            recv: (message, addrInfo) => {  
              this.console.log(`recv to ${addrInfo.address}:\n${sip.stringify(message)}`); 
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
      rq.headers.to = {uri: rq.headers.to.uri, params: { tag: 'govno' }};
      this.state = {
        status: DialogStatus.Ringing,
        msg: rq
      }
      let rs = this.makeRs(rq, 180, 'Ringing');
      sip.send(rs);
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
    if (this.state.status == DialogStatus.AnswerAc ||
        this.state.status == DialogStatus.Hangup) 
    {
      this.clearState();
      sip.send (this.makeRs (rq, 200, 'OK'));
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

  private fakeSdpContent()
  {
    const ipv = isV4Format (this.localIp) ? 'IP4' : 'IP6';
    const ip = `${ipv} ${this.localIp}`;
    return 'v=0\r\n' +
    `o=yate 1707679323 1707679323 IN ${ip}\r\n` +
    's=SIP Call\r\n' +
    `c=IN ${ip}\r\n` +
    't=0 0\r\n' +
    'm=audio 9654 RTP/AVP 0 101\r\n' +
    'a=rtpmap:0 PCMU/8000\r\n' +
    'a=rtpmap:101 telephone-event/8000\r\n';
  }

  private bye (rq: any): any
  {
    const toUser = sip.parseUri(rq.headers.to.uri).user;
    let uri = rq.headers.contact[0] && rq.headers.contact[0].uri;
    if (uri === undefined) {
      uri = rq.headers.from.uri;
    }

    let msg = {
      method: 'BYE',
      uri: uri,
      headers: {
        to: rq.headers.from,
        from: rq.headers.to,
        'call-id': rq.headers['call-id'],
        cseq: {method: 'BYE', seq: rq.headers.cseq.seq + 1},
        contact: `sip:${toUser}@${this.localIp}:${this.localPort}` 
      }
    }

    if (this.authCtx.realm) 
    {
      digest.signRequest (this.authCtx, msg);
      msg.headers.cseq.seq = this.authCtx.nc;
    }

    return msg;
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

    const creds = this.clientCreds;
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

    this.state = {
      status: DialogStatus.Regitering,
      msg: {...initMsg}
    }

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

  private clearState() {
    this.state = { status: DialogStatus.Idle };
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
        return this.clientCreds.ip === ip || this.ip === ip;
      }
    }

    return this.ip === remote.address;
  }
}
