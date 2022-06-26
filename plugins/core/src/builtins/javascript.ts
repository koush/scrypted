import { Logger, EventDetails, ScryptedDevice } from "@scrypted/sdk";
import { Automation } from "../automation";
import { scryptedEval } from "../scrypted-eval";

export class AutomationJavascript {
    eventSource: ScryptedDevice;
    eventDetails: EventDetails;
    eventData: any;
    log: Logger;

    constructor(public automation: Automation, eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) {
        this.eventSource = eventSource;
        this.eventDetails = eventDetails;
        this.eventData = eventData;
    }

    async run(script: string) {
        return (await scryptedEval(this.automation, script, {
            eventDetails: this.eventDetails,
            eventData: this.eventData,
            eventSource: this.eventSource,
        })).value;
    }
}
