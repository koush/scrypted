import { EventDetails, EventListenerRegister, OnOff, ScryptedDevice, ScryptedDeviceBase } from "@scrypted/sdk";
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

export class Automation extends ScryptedDeviceBase implements OnOff {
    registers: EventListenerRegister[] = [];
    pendings = new Map<string, Abort>();

    constructor(nativeId: string) {
        super(nativeId);

        this.bind();

        this.on = this.storage.getItem('enabled') !== 'false';
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
            const { denoiseEvents, runToCompletion, staticEvents } = data;

            const runActions = async (eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any) => {
                const pendingKey = staticEvents ? undefined : eventSource.id + ':' + eventDetails.eventInterface;
                const pending = this.pendings.get(pendingKey);
                this.console.log('automation trigger key', pendingKey);

                if (runToCompletion && pending) {
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
                    denoise: denoiseEvents,
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
