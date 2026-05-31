import sdk, { PasswordStore, ScryptedInterface } from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";
import { CommandClass, UserCodeCC, UserIDStatus } from "zwave-js";
import type { UserCode } from "@zwave-js/cc/UserCodeCC"
const { deviceManager } = sdk;

function isEmpty(str: string) {
    return !str || !str.length;
}

export class PasswordStoreToUserCode extends ZwaveDeviceBase implements PasswordStore {
    codeCount: number;
    getting: Map<number, Promise<Pick<UserCode, "userIdStatus" | "userCode">>>;

    getGetting(): Map<number, Promise<Pick<UserCode, "userIdStatus" | "userCode">>> {
        if (!this.getting)
            this.getting = new Map<number, Promise<Pick<UserCode, "userIdStatus" | "userCode">>>();
        return this.getting;
    }

    async getPasswords(): Promise<string[]> {
        const cc = this.instance.getNodeUnsafe().commandClasses['User Code'];
        if (this.codeCount == null)
            this.codeCount = await cc.getUsersCount();
        const count = this.codeCount;
        const passwords = new Set<string>();
        for (let i = 1; i <= count; i++) {
            const entry = this.getCachedPassword(i);
            if (!entry) {
                this.getPassword(i);
                continue;
            }
            if (entry.userIdStatus === UserIDStatus.Enabled)
                passwords.add(entry.userCode);
        }
        return Array.from(passwords);
    }

    getCachedPassword(index: number): Pick<UserCode, "userIdStatus" | "userCode"> {
        const key = "password-" + index;
        var known = this.storage.getItem(key);
        if (known) {
            try {
                return JSON.parse(known);
            }
            catch (e) {
            }
        }
    }

    async getPassword(index: number): Promise<Pick<UserCode, "userIdStatus" | "userCode">> {
        const cached = this.getCachedPassword(index);
        if (cached)
            return cached;
        const key = "password-" + index;

        const cc = this.instance.getNodeUnsafe().commandClasses['User Code'];
        const getting = this.getGetting();
        let get = getting.get(index);
        if (!get) {
            get = cc.get(index).then(entry => {
                const userCode = entry.userCode?.toString().trim();
                const cleaned: Pick<UserCode, "userIdStatus" | "userCode"> = entry ? {
                    userIdStatus: entry.userIdStatus,
                    userCode,
                } : undefined;

                this.storage.setItem(key, JSON.stringify(cleaned));
                this.notifyChange();
                return cleaned;
            })
                .finally(() => getting.delete(index));
            getting.set(index, get);
        }
        return get;
    }

    async addPassword(password: string) {
        const cc = this.instance.getNodeUnsafe().commandClasses['User Code'];
        const count = await cc.getUsersCount();
        for (var i = 1; i <= count; i++) {
            var entry = await this.getPassword(i);
            if (entry.userIdStatus === UserIDStatus.Available || entry.userCode === password) {
                this.log.i(`Setting code ${password} on code ${i}`);
                const key = "password-" + i;
                this.storage.removeItem(key);
                const result = await cc.set(i, UserIDStatus.Enabled, password);
                this.log.i(`Set code ${password} on code ${i} complete`);
                this.console.log('code set', result);
                this.notifyChange();
                return;
            }
        }
    }

    async removePassword(password: string) {
        if (!password)
            return;
        const cc = this.instance.getNodeUnsafe().commandClasses['User Code'];
        const count = await cc.getUsersCount();
        for (var i = 1; i < count; i++) {
            var entry = await this.getPassword(i);
            if (password === entry.userCode) {
                this.log.i(`Removing code ${password} on code ${i}`);
                const key = "password-" + i;
                this.storage.removeItem(key);
                await cc.clear(i);
                this.log.i(`Removed code ${password} on code ${i}`);
            }
        }

        this.notifyChange();
    }

    async checkPassword(password: string): Promise<boolean> {
        return (await this.getPasswords()).includes(password);
    }

    notifyChange() {
        deviceManager.onDeviceEvent(this.nativeId, ScryptedInterface.PasswordStore, null);
    }

    static onValueChanged(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        var pass = zwaveDevice as PasswordStoreToUserCode;
        pass.notifyChange();
    }
}
