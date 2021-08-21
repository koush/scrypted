import { EventDetails, ScryptedDevice, SystemManager } from "@scrypted/sdk";

export class Javascript {
    systemManager: SystemManager;
    eventSource: ScryptedDevice;
    eventDetails: EventDetails;
    eventData: any;

    constructor(systemManager: SystemManager, eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) {
        this.systemManager = systemManager;
        this.eventSource = eventSource;
        this.eventDetails = eventDetails;
        this.eventData = eventData;
    }

    run(script: string) {
        const f = eval(`(function script(systemManager, eventSource, eventDetails, eventData) {
            ${script}
        })`);

        f(this.systemManager, this.eventSource, this.eventDetails, this.eventData);
    }
}
