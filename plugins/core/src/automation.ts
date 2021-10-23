import { EventDetails, EventListenerRegister, OnOff, ScryptedDevice, ScryptedDeviceBase, Setting, Settings, SettingValue } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { AutomationJavascript } from "./builtins/javascript";
import { Scheduler } from "./builtins/scheduler";
import { Listen } from "./builtins/listen";
import { scryptedEval } from "./scrypted-eval";
import { AutomationShellScript } from "./builtins/shellscript";
const { systemManager } = sdk;

interface Abort {
    aborted: boolean;
}

export class Automation extends ScryptedDeviceBase implements OnOff, Settings {
    registers: EventListenerRegister[] = [];
    pendings = new Map<string, Abort>();

    constructor(nativeId: string) {
        super(nativeId);

        this.bind();

        this.on = this.storage.getItem('enabled') !== 'false';
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'denoiseEvents',
                value: this.storage.getItem('denoiseEvents') === 'true',
                title: 'Denoise Events',
                description: 'Denoising events will suppress events where the same event data is sent multiple times in a row. For example, if a sensor sent multiple door open events, only the first event will trigger this automation. The automation will fire again once the door sends a close event.',
                type: 'boolean',
            },
            {
                key: 'runToCompletion',
                value: this.storage.getItem('runToCompletion') === 'true',
                title: 'Run Automations to Completion',
                description: 'By default, automations that are executing will reset if triggered by a new event. Check this box to require an automation to run to completion before it can be triggered again. This setting can be used in conjunction with a timer to prevent an automation from running too often.',
                type: 'boolean',
            },
            {
                key: 'staticEvents',
                value: this.storage.getItem('staticEvents') === 'true',
                title: 'Reset Automation on All Events',
                description: 'By default, running Automation timers will be reset if the same device fires the event again. Check this box to reset Automation timers on all of the configured events.',
                type: 'boolean',
            },
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
        this.bind();
    }

    async eval(script: string, variables: { [name: string]: any }) {
        return scryptedEval(this, script, variables);
    }

    async turnOff() {
        this.storage.setItem('enabled', 'false');
        this.on = false;
        this.bind();
    }

    async turnOn() {
        this.storage.removeItem('enabled');
        this.on = true;
        this.bind();
    }

    abort(id?: string) {
        if (!id) {
            for (const abort of this.pendings.values()) {
                abort.aborted = true;
            }
            this.pendings.clear();
        }
        else {
            const pending = this.pendings.get(id);
            if (pending) {
                this.pendings.delete(id);
                pending.aborted = true;
            }
        }
    }

    bind() {
        this.abort();
        for (const register of this.registers) {
            register.removeListener();
        }
        this.registers = [];

        if (!this.on) {
            this.log.i('automation is turned off, and will not be scheduled.')
            return;
        }
        this.log.i('automation is waiting for event trigger.')

        try {
            const data = JSON.parse(this.storage.getItem('data'));
            const { denoiseEvents, runToCompletion, staticEvents } = this.storage;

            const runActions = async (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) => {
                const pendingKey = staticEvents === 'true' ? undefined : eventSource.id + ':' + eventDetails.eventInterface;
                const pending = this.pendings.get(pendingKey);
                this.console.log('automation trigger key', pendingKey);

                if (runToCompletion === 'true' && pending) {
                    this.console.info('automation already in progress, trigger ignored', pendingKey);
                    return;
                }
                if (pending) {
                    pending.aborted = true;
                }
                const abort: Abort = {
                    aborted: false,
                }
                this.pendings.set(pendingKey, abort);

                try {
                    for (const action of data.actions) {
                        if (abort.aborted) {
                            this.console.log('automation aborted', pendingKey);
                            return;
                        }

                        const parts = action.id.split('#');
                        const id = parts[0];

                        if (id === 'scriptable') {
                            const script = new AutomationJavascript(this, eventSource, eventDetails, eventData);
                            await script.run(action.model['script.ts'])
                        }
                        else if (id === 'shell-scriptable') {
                            const script = new AutomationShellScript(this, eventSource, eventDetails, eventData);
                            await script.run(action.model['script.sh'])
                        }
                        else if (id === 'timer') {
                            await new Promise(resolve => setTimeout(resolve, action.model.seconds * 1000));
                        }
                        else if (id === 'update-plugins') {
                            const plugins = await systemManager.getComponent('plugins');
                            await plugins.updatePlugins();
                        }
                        else {
                            const device = systemManager.getDeviceById(id);
                            if (!device)
                                throw new Error(`unknown action ${action.id}`);

                            const { rpc } = action.model;
                            device[rpc.method](...rpc.parameters || []);
                        }
                    }
                }
                finally {
                    if (!abort.aborted) {
                        this.pendings.delete(pendingKey);
                    }
                }
            }

            for (const trigger of data.triggers) {
                const parts = trigger.id.split('#');
                const id = parts[0];
                const event = parts[1];
                const { condition } = trigger;

                let register: EventListenerRegister;
                let listen: Listen;
                if (event) {
                    const device = systemManager.getDeviceById(id);
                    listen = device;
                }
                else {
                    let device: any;
                    if (id === 'scheduler') {
                        device = new Scheduler();
                    }
                    else {
                        throw new Error(`unknown action ${trigger.id}`);
                    }

                    const { rpc } = trigger.model;
                    listen = device[rpc.method](...rpc.parameters || []);
                }

                register = listen.listen({
                    denoise: denoiseEvents === 'true',
                    event,
                }, (eventSource, eventDetails, eventData) => {
                    this.log.i(`automation triggered by ${eventSource.name}`);

                    if (condition) {
                        const f = eval(`(function(eventSource, eventDetails, eventData) {
                            return ${condition};
                        })`);

                        if (!f(eventSource, eventDetails, eventData)) {
                            this.log.i('condition check false, not starting automation');
                            return;
                        }
                    }

                    console.log('starting automation');
                    runActions(eventSource, eventDetails, eventData);
                }, this);

                this.registers.push(register);
            }
        }
        catch (e) {
            console.error('automation load error', e);
        }
    }
}
