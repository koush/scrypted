import { RTCSessionControl } from "@scrypted/sdk";

export class ScryptedSessionControl implements RTCSessionControl {
    constructor(public cleanup: () => Promise<void>) {
    }

    async getRefreshAt() {
    }
    async extendSession() {
    }
    async endSession() {
        await this.cleanup();
    }
}
