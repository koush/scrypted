import { Axios, Method } from "axios";
import { getEndPointWithCountryName } from "./deprecated";
import {
  TuyaDeviceStatus,
  RTSPToken,
  TuyaDevice,
  TuyaResponse
} from "./const";
import { randomBytes, createHmac, hash } from "node:crypto";

/**
 * @deprecated Will eventually be removed in favor of Sharing SDK
 */
export type TuyaCloudTokenInfo = {
  uid: string;
  expires: number;
  accessToken: string;
  refreshToken: string;

  country: string;
  clientId: string;
  clientSecret: string;
}

/**
 * @deprecated Will eventually be removed in favor of Sharing SDK
 */
export class TuyaCloudAPI {
  private readonly nonce: string;
  private client: Axios;
  private tokenInfo: TuyaCloudTokenInfo;
  private updateToken: (token: TuyaCloudTokenInfo) => void;
  private requiresReauthentication: () => void;

  constructor(
    initialTokenInfo: TuyaCloudTokenInfo, 
    updateToken: (token: TuyaCloudTokenInfo) => void, 
    requiresReauth: () => void
  ) {
    this.tokenInfo = initialTokenInfo;
    this.updateToken = updateToken;
    this.requiresReauthentication = requiresReauth;
    this.nonce = randomBytes(16).toString('hex');
    this.client = new Axios({
      baseURL: getEndPointWithCountryName(this.tokenInfo.country),
      timeout: 5 * 1e3,
    });
  }

  private get isSessionValid(): boolean {
    return this.tokenInfo.expires > Date.now();
  }

  // Set Device Status

  public async sendCommands(
    deviceId: string,
    commands: TuyaDeviceStatus[]
  ): Promise<boolean> {
    return this._request<boolean>(
      "POST",
      `/v1.0/devices/${deviceId}/commands`,
      undefined,
      { commands }
    )
    .then(r => !!r.success && !!r.result)
    .catch(() => false)
  }

  // Get Devices

  public async fetchDevices(): Promise<TuyaDevice[]> {
    let response = await this._request<TuyaDevice[]>("get", `/v1.0/users/${this.tokenInfo.uid}/devices`);

    if (!response.success) {
      throw Error(`Failed to fetch Device configurations.`);
    }

    let devices = response.result;

    for (var i = 0; i < devices.length; i++) {
      var device = devices[i];
      const response = await this._request("get", `/v1.0/devices/${device.id}/functions`);
      if (!response.success) continue;
      // TODO: Add schema
      // device.schema = response.result.function;
      devices[i] = device;
    }
    return devices;
  }

  // Camera Functions

  public async getRTSP(cameraId: string): Promise<RTSPToken> {
    const response = await this._request<{ url: string }>(
      "POST",
      `/v1.0/devices/${cameraId}/stream/actions/allocate`,
      { type: "rtsp" }
    );

    if (response.success) {
      return {
        url: response.result.url,
        expires: (response?.t ?? 0) + 30_000, // This will expire in 30 seconds.
      };
    } else {
      throw new Error(`Failed to retrieve RTSP for camera ID: ${cameraId}`)
    }
  }

  // Tuya IoT Cloud Requests API

  private async _request<T = any>(
    method: Method,
    path: string,
    query: { [k: string]: any } = {},
    body: { [k: string]: any } = {}
  ): Promise<TuyaResponse<T>> {
    await this.refreshAccessTokenIfNeeded();

    const timestamp = Date.now().toString();
    const headers = { client_id: this.tokenInfo.clientId };

    const stringToSign = getStringToSign(
      method,
      path,
      query,
      headers,
      body
    );

    const hashed = createHmac("sha256", this.tokenInfo.clientSecret);
    hashed.update(
      this.tokenInfo.clientId +
      this.tokenInfo.accessToken +
      timestamp +
      this.nonce +
      stringToSign,
    )

    const sign = hashed.digest('hex').toUpperCase();

    let requestHeaders = {
      client_id: this.tokenInfo.clientId,
      sign: sign,
      sign_method: "HMAC-SHA256",
      t: timestamp,
      access_token: this.tokenInfo.accessToken,
      "Signature-Headers": Object.keys(headers).join(":"),
      nonce: this.nonce,
    };

    return this.client
      .request<TuyaResponse<T>>({
        method,
        url: path,
        data: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        params: query,
        headers: requestHeaders,
        responseType: "json",
        transformResponse: (data) => JSON.parse(data),
      })
      .then((value) => {
        return value.data;
      });
  }

  private async refreshAccessTokenIfNeeded() {
    if (this.isSessionValid) {
      return;
    }

    const url = `/v1.0/token/${this.tokenInfo.refreshToken}`;

    const timestamp = Date.now.toString();
    const stringToSign = getStringToSign("GET", url);

    const sign = createHmac('sha256', this.tokenInfo.clientSecret);
    sign.update(this.tokenInfo.clientId + timestamp + stringToSign);

    const signString = sign.digest('hex').toUpperCase();

    const headers = {
      t: timestamp,
      sign_method: "HMAC-SHA256",
      client_id: this.tokenInfo.clientId,
      sign: signString,
    };

    let { data } = await this.client.get(url, { headers });

    let response = JSON.parse(data) as TuyaResponse<{
      access_token: string;
      refresh_token: string;
      expire_time: number;
      uid: string;
    }>;

    if (!response.success) throw new Error(`Failed to generate access token. Reauthentication required.`);

    this.tokenInfo = {
      ...this.tokenInfo,
      accessToken: response.result.access_token,
      refreshToken: response.result.refresh_token,
      expires: (response.t ?? 0) + (response.result.expire_time ?? 0) * 1000,
      uid: response.result.uid
    };
  }

  static async fetchToken(
    userId?: string,
    clientId?: string,
    clientSecret?: string,
    country?: string
  ): Promise<TuyaCloudTokenInfo> {
    if (!userId || !clientId || !clientSecret || !country) throw Error('Missing credential information.');
    return Promise.reject();
  }
}

/**
 * @deprecated Will eventually be removed in favor of Sharing SDK
 */
function getStringToSign(
  method: Method,
  path: string,
  query: { [k: string]: any } = {},
  headers: { [k: string]: string } = {},
  body: { [k: string]: any } = {}
): string {
  const isQueryEmpty = Object.keys(query).length == 0;
  const isHeaderEmpty = Object.keys(headers).length == 0;
  const isBodyEmpty = Object.keys(body).length == 0;
  const httpMethod = method.toUpperCase();
  const url =
    path +
    (isQueryEmpty
      ? ""
      : "?" +
      Object.keys(query)
        .map((key) => `${key}=${query[key]}`)
        .join("&"));
  const contentHashed = hash("sha256", isBodyEmpty ? "" : JSON.stringify(body));
  const headersParsed = Object.keys(headers)
    .map((key) => `${key}:${headers[key]}`)
    .join("\n");
  const headersStr = isHeaderEmpty ? "" : headersParsed + "\n";
  const signStr = [httpMethod, contentHashed, headersStr, url].join("\n");
  return signStr;
}