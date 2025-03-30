import { Axios, Method } from "axios";
import { RTSPToken, TuyaDeviceConfig, TuyaDeviceFunction, TuyaDeviceStatus, TuyaDeviceStatusRange, TuyaResponse } from "./const";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomInt, randomUUID } from "node:crypto";

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

  private client: Axios;
  private tokenInfo: TuyaSharingTokenInfo;
  private updateToken: (token: TuyaSharingTokenInfo) => void;
  private requiresReauthentication: () => void;

  constructor(
    initialTokenInfo: TuyaSharingTokenInfo, 
    updateToken: (token: TuyaSharingTokenInfo) => void, 
    requiresReauth: () => void
  ) {
    this.tokenInfo = initialTokenInfo;
    this.updateToken = updateToken;
    this.requiresReauthentication = requiresReauth;
    this.client = new Axios({
      baseURL: this.tokenInfo.endpoint
    });
  }

  public async fetchDevices(): Promise<TuyaDeviceConfig[]> {
    const homes = await this.queryHomes();
    const firstHomeId = homes.at(0)?.ownerId;
    if (!firstHomeId) return [];
    const devicesResponse = await this._request<TuyaDeviceConfig[]>("GET", "/v1.0/m/life/ha/home/devices", { homeId: firstHomeId });
    return Promise.all((devicesResponse.result || [])
      .map(p => this.updateDeviceSpecs(p).catch(() => p)));
  }

  public async updateDevice(deviceId: string, commands: TuyaDeviceStatus[]): Promise<boolean> {
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

  private async queryHomes() {
    const response = await this._request<[{ uid: string, id: number, ownerId: string, name: string }]>("GET", "/v1.0/m/life/users/homes");
    return response?.result || [];
  }

  private async updateDeviceSpecs(device: TuyaDeviceConfig): Promise<TuyaDeviceConfig> {
    device.functions = {}
    device.status_range = {};
    try {
      const response = await this._request<{ category: string, functions?: TuyaDeviceFunction[], status?: TuyaDeviceStatusRange[] } | undefined>("get", `/v1.1/m/life/${device.id}/specifications`);
      if (!!response.result?.functions) {
        for (const func of response.result.functions) {
          device.functions[func.code] = func;
        }
      }

      if (!!response.result?.status) {
        for (const status of response.result.status) {
          device.status_range[status.code] = status;
        }
      }
    } catch {
      console.log(`[TuyaSharing] Could not fetch specifications for device: ${device.name} [${device.id}]`)
    }
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

    const response = await this.client.request({
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
    const tokenInfo = this.tokenInfo;
    if (tokenInfo.expires > Date.now()) return;

    const response = await this._request<{
      access_token: string;
      refresh_token: string;
      uid: string;
      expire_time?: number;
      terminal_id: string;
      endpoint: string;
      username: string;
    }>("GET", `/v1.0/m/token/${tokenInfo.refreshToken}`, undefined, undefined, true);

    if (!response.success) {
      this.requiresReauthentication();
      throw Error(`Failed to get new refesh token. Requires reauthentcation.`);
    }

    this.tokenInfo = {
      ...tokenInfo,
      expires: (response.t ?? 0) + (response.result.expire_time ?? 0) * 1000,
      accessToken: response.result.access_token,
      refreshToken: response.result.refresh_token,
      terminalId: response.result.terminal_id ?? tokenInfo.terminalId
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