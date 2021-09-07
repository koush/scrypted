import { Logger, EventDetails, ScryptedDevice, SystemManager } from "@scrypted/sdk";
import ts, { ScriptTarget } from "typescript";
import { Automation } from "../automation";

function tsCompile(source: string, options: ts.TranspileOptions = null): string {
    // Default options -- you could also perform a merge, or use the project tsconfig.json
    if (null === options) {
        options = {
            compilerOptions: {
                target: ScriptTarget.ESNext,
                module: ts.ModuleKind.CommonJS
            }
        };
    }
    return ts.transpileModule(source, options).outputText;
}

export class Javascript {
    systemManager: SystemManager;
    eventSource: ScryptedDevice;
    eventDetails: EventDetails;
    eventData: any;
    log: Logger;

    constructor(systemManager: SystemManager, public automation: Automation, eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any, log: Logger) {
        this.systemManager = systemManager;
        this.eventSource = eventSource;
        this.eventDetails = eventDetails;
        this.eventData = eventData;
        this.log = log;
    }

    async run(script: string) {
        try {
            const compiled = tsCompile(script);

            try {
                const f = eval(`(function script(systemManager, eventSource, eventDetails, eventData, log) {
                    ${compiled}
                })`);

                try {
                    await f(this.systemManager, this.eventSource, this.eventDetails, this.eventData, this.log);
                }
                catch (e) {
                    this.log.e('Error running script.');
                    this.automation.console.error(e);
                }
            }
            catch (e) {
                this.log.e('Error evaluating script.');
                this.automation.console.error(e);
            }
        }
        catch (e) {
            this.log.e('Error compiling script.');
            this.automation.console.error(e);
        }
    }
}
