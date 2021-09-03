import { Logger, EventDetails, ScryptedDevice, SystemManager } from "@scrypted/sdk";

export class Javascript {
    systemManager: SystemManager;
    eventSource: ScryptedDevice;
    eventDetails: EventDetails;
    eventData: any;
    log: Logger;

    constructor(systemManager: SystemManager, eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any, log: Logger) {
        this.systemManager = systemManager;
        this.eventSource = eventSource;
        this.eventDetails = eventDetails;
        this.eventData = eventData;
        this.log = log;
    }

    run(script: string) {
        const f = eval(`(function script(systemManager, eventSource, eventDetails, eventData, log) {
            ${script}
        })`);

        f(this.systemManager, this.eventSource, this.eventDetails, this.eventData, this.log);
    }
}
