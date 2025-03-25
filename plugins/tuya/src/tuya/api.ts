export enum TuyaLoginMethod {
  App = "Tuya (Smart Life) App",
  Account = "Tuya Developer Account"
}

export type TuyaAppLogin = {
  type: TuyaLoginMethod.App
  userCode: string;
}

export type TuyaDeveloperLogin = {
  type: TuyaLoginMethod.Account
  userId: string;
  accessId: string;
  accessSecret: string;
  country: string;
}

export type TuyaLogin = TuyaAppLogin | TuyaDeveloperLogin;

class TuyaAPI {
}