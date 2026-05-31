import { Logger, EventDetails, ScryptedDevice } from "@scrypted/sdk";
import { Automation } from "../automation";
import child_process from 'child_process';

export class AutomationShellScript {
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
        const cp = child_process.spawn('sh', {
            env: {
                EVENT_DATA: this.eventData?.toString(),
            },
        });
        cp.stdin.write(script);
        cp.stdin.end();
        cp.stdout.on('data', data => this.automation.console.log(data.toString()));
        cp.stderr.on('data', data => this.automation.console.log(data.toString()));
        cp.on('exit', () => this.automation.console.log('shell exited'));
    }
}
