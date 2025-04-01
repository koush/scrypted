import { Axios, Method } from "axios";
import { RTSPToken, TuyaDevice, TuyaDeviceFunction, TuyaDeviceSchema, TuyaDeviceStatus, TuyaResponse } from "./const";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { MqttConfig } from "./mq";

export type TuyaSharingTokenInfo = {
  userCode: string;
  uid: string;
  accessToken: string;
  refreshToken: string;
  expires: number;
  terminalId: string;
  username: string;
  endpoint: string;
}

export type TuyaLoginQRCode = { userCode: string } & TuyaResponse<{ qrcode: string }>

export class TuyaSharingAPI {
  private static clientId = "HA_3y9q4ak7g4ephrvke";

  private session: Axios;
  private tokenInfo: TuyaSharingTokenInfo;
  private updateToken: (token: TuyaSharingTokenInfo) => void;
  private requiresReauthentication: () => void;
  private updatingTokenPromise: Promise<void> | null = null;

  constructor(
    initialTokenInfo: TuyaSharingTokenInfo,
    updateToken: (token: TuyaSharingTokenInfo) => void,
    requiresReauth: () => void
  ) {
    this.tokenInfo = initialTokenInfo;
    this.updateToken = updateToken;
    this.requiresReauthentication = requiresReauth;
    this.session = new Axios({
      baseURL: this.tokenInfo.endpoint
    });
  }

  public async fetchDevices(): Promise<TuyaDevice[]> {
    const homes = await this.queryHomes();
    const firstHomeId = homes.at(0)?.ownerId;
    if (!firstHomeId) return [];
    const devicesResponse = await this._request<TuyaDevice[]>("GET", "/v1.0/m/life/ha/home/devices", { homeId: firstHomeId });
    return Promise.all((devicesResponse.result || [])
      .map(p => this.updateDeviceSpecs(p).catch(() => p)));
  }

  public async sendCommands(deviceId: string, commands: TuyaDeviceStatus[]): Promise<boolean> {
    return this._request<boolean>("post", `/v1.1/m/thing/${deviceId}/commands`, undefined, { commands })
      .then(r => !!r.success && !!r.result)
      .catch(() => false)
  }

  public async getRTSP(deviceId: string): Promise<RTSPToken> {
    const response = await this._request<{ url: string }>(
      "post",
      `/v1.0/m/ipc/${deviceId}/stream/actions/allocate`,
      undefined,
      { type: "rtsp" }
    );

    if (response.success) {
      return {
        url: response.result.url,
        expires: (response?.t ?? 0) + 30_000, // This will expire in 30 seconds.
      };
    } else {
      throw new Error(`Failed to retrieve RTSP for camera ${deviceId}`)
    }
  }

  public async fetchMqttConfig(): Promise<MqttConfig> {
    const linkId = "@scrypted/tuya." + randomUUID();
    const response = await this._request<{
      url: string,
      clientId: string, 
      username: string, 
      password: string, 
      expireTime: number, 
      topic: { 
        ownerId: { sub: string }, 
        devId: { sub: string } 
      } 
    }>(
      "post",
      "/v1.0/m/life/ha/access/config",
      undefined,
      { linkId }
    );

    if (!response.success) throw new Error("Failed to fetch MQTT Config");

    return {
      url: response.result.url,
      clientId: response.result.clientId,
      username: response.result.username,
      password: response.result.password,
      sourceTopic: response.result.topic.ownerId.sub,
      sinkTopic: response.result.topic.devId.sub,
      expires: (response.t ?? 0) + (response.result.expireTime ?? 0) * 1000
    }
  }

  private async queryHomes() {
    const response = await this._request<[{ uid: string, id: number, ownerId: string, name: string }]>("GET", "/v1.0/m/life/users/homes");
    return response?.result || [];
  }

  private async updateDeviceSpecs(device: TuyaDevice): Promise<TuyaDevice> {
    const schemas = new Map<string, TuyaDeviceSchema>();

    try {
      const response = await this._request<{ status: TuyaDeviceFunction[], functions: TuyaDeviceFunction[] }>("get", `/v1.1/m/life/${device.id}/specifications`);

      for (const { code, type, values } of [...response.result.status, ...response.result.functions]) {
        const read = response.result.status.find(r => r.code == code);
        const write = response.result.functions.find(f => f.code == code);
        try {
          schemas.set(code, {
            code,
            mode: !!read && !!write ? "rw" : !!write ? "w" : "r",
            type: type as any,
            specs: JSON.parse(values)
          });
        } catch {
          continue;
        }
      }
    } catch {
      console.log(`[TuyaSharing] Could not fetch specifications for device: ${device.name} [${device.id}]`)
    }
    device.schema = Array.from(schemas.values());
    return device;
  }

  private async _request<T = any>(
    method: Method,
    path: string,
    params?: { [k: string]: any },
    body?: { [k: string]: any },
    skipRefreshToken?: boolean
  ): Promise<TuyaResponse<T>> {
    if (!skipRefreshToken) await this.refreshTokenIfNeeded();

    const rid = randomUUID();
    const sid = "";
    const md5 = createHash("md5");
    const ridRefreshToken = rid + this.tokenInfo.refreshToken;
    md5.update(ridRefreshToken, "utf-8");
    const hashKey = md5.digest("hex");
    const secret = _secretGenerating(rid, sid, hashKey);

    var queryEncData = "";
    if (params && Object.keys(params).length > 0) {
      queryEncData = _aesGcmEncrypt(_formToJson(params), secret);
      params = { "encdata": queryEncData };
    }

    var bodyEncData = ""
    if (body && Object.keys(body).length > 0) {
      bodyEncData = _aesGcmEncrypt(_formToJson(body), secret);
      body = { "encdata": bodyEncData };
    }

    const t = Date.now();

    const headers = new Map<string, string>();
    headers.set("X-appKey", TuyaSharingAPI.clientId)
    headers.set("X-requestId", rid)
    headers.set("X-sid", sid)
    headers.set("X-time", t.toString())
    headers.set("X-token", this.tokenInfo.accessToken)
    headers.set("X-sign", _restfulSign(hashKey, queryEncData, bodyEncData, headers));

    const response = await this.session.request({
      method,
      url: path,
      params: !params || !Object.keys(params).length ? undefined : params,
      headers: Object.fromEntries(headers),
      data: !body || !Object.keys(body).length ? undefined : JSON.stringify(body)
    });

    const ret = response.data ? JSON.parse(response.data) as TuyaResponse<string> : undefined;
    if (!ret) throw Error(`Failed to receive response`);

    return {
      ...ret,
      result: typeof ret.result == "string" ? JSON.parse(_aesGcmDencrypt(ret.result, secret)) as T : ret.result
    };
  }

  private async refreshTokenIfNeeded() {
    if (this.updatingTokenPromise) {
      await this.updatingTokenPromise;
    } else {
      this.updatingTokenPromise = this._internalRefreshTokenIfNeeded().finally(() => this.updatingTokenPromise = null);
      await this.updatingTokenPromise;
    }
  }

  private async _internalRefreshTokenIfNeeded() {
    if (this.tokenInfo.expires > Date.now()) return;

    const response = await this._request<{
      accessToken: string;
      refreshToken: string;
      uid: string;
      expireTime?: number;
    }>("GET", `/v1.0/m/token/${this.tokenInfo.refreshToken}`, undefined, undefined, true);

    if (!response.success) {
      this.requiresReauthentication();
      throw Error(`Failed to get new refesh token. Requires reauthentcation.`);
    }

    this.tokenInfo = {
      ...this.tokenInfo,
      expires: (response.t ?? 0) + (response.result.expireTime ?? 0) * 1000,
      accessToken: response.result.accessToken,
      refreshToken: response.result.refreshToken
    };
    this.updateToken(this.tokenInfo);
  }

  static async generateQRCode(userCode: string): Promise<TuyaLoginQRCode> {
    const session = new Axios({})
    const response = await session.request({
      method: "POST",
      url: 'https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens',
      params: {
        clientid: TuyaSharingAPI.clientId,
        usercode: userCode,
        schema: "haauthorize"
      },
      headers: {}
    });
    const data = JSON.parse(response.data) as TuyaResponse<{ qrcode: string }>;
    if (!data.success) throw Error('Failed to fetch qr code with user code.');
    return { userCode, ...data }
  }

  static async fetchToken(qrCodeLogin: TuyaLoginQRCode): Promise<TuyaSharingTokenInfo> {
    const session = new Axios({})
    const response = await session.request({
      method: "GET",
      url: `https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens/${qrCodeLogin.result.qrcode}`,
      params: {
        clientid: TuyaSharingAPI.clientId,
        usercode: qrCodeLogin.userCode
      },
      headers: {}
    });
    const data = JSON.parse(response.data) as TuyaResponse<{
      access_token: string;
      refresh_token: string;
      uid: string;
      expire_time?: number;
      terminal_id: string;
      endpoint: string;
      username: string;
    }>;
    if (!data.success) throw Error('Failed to fetch token from qr code.');
    return {
      userCode: qrCodeLogin.userCode,
      uid: data.result.uid,
      expires: (data.t ?? 0) + (data.result.expire_time ?? 0) * 1000,
      accessToken: data.result.access_token,
      refreshToken: data.result.refresh_token,
      terminalId: data.result.terminal_id,
      endpoint: data.result.endpoint,
      username: data.result.username
    };
  }
}

function _formToJson(content: Record<string, any>) {
  return JSON.stringify(content, null, 0);
}

function _secretGenerating(rid: string, sid: string, hashKey: string) {
  let message = hashKey;
  const mod = 16;

  if (sid != "") {
    const sidLength = sid.length;
    const length = sidLength < mod ? sidLength : mod;
    let ecode = "";
    for (let i = 0; i < length; i++) {
      const idx = sid.charCodeAt(i) % mod;
      ecode += sid[idx];
    }
    message += "_";
    message += ecode;
  }

  const checksum = createHmac('sha256', rid).update(message, "utf-8").digest();
  const secret = checksum.toString('hex');
  return secret.substring(0, 16);
}

function _randomNonce(e: number = 32) {
  const t = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  const a = t.length;
  let n: string = "";
  for (let i = 0; i < e; i++) {
    n += t[randomInt(0, a)];
  }
  return Buffer.from(n, "utf-8");
}

function _aesGcmEncrypt(rawData: string, secret: string) {
  const nonce = _randomNonce(12);
  const cipher = createCipheriv('aes-128-gcm', Buffer.from(secret, "utf-8"), nonce);
  const encrypted = Buffer.concat([cipher.update(rawData, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, authTag]).toString('base64');
}

function _aesGcmDencrypt(cipherData: string, secret: string) {
  const cypherBuffer = Buffer.from(cipherData, 'base64');
  const nonce = cypherBuffer.subarray(0, 12);
  const cipherText = cypherBuffer.subarray(12);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(secret, "utf-8"), nonce);
  decipher.setAuthTag(cipherText.subarray(-16));
  const encryptedData = cipherText.subarray(0, -16);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString('utf8');
}

function _restfulSign(
  hashKey: string,
  queryEncData: string,
  bodyEncData: string,
  data: Map<string, string>
) {
  const headers = ["X-appKey", "X-requestId", "X-sid", "X-time", "X-token"];
  var headerSign: string[] = [];

  for (const item of headers) {
    const val = data.get(item) || "";
    if (val) headerSign.push(`${item}=${val}`);
  }

  var signStr = headerSign.join("||");

  if (queryEncData) signStr += queryEncData;
  if (bodyEncData) signStr += bodyEncData;

  return createHmac('sha256', hashKey)
    .update(signStr, "utf-8")
    .digest('hex')
}