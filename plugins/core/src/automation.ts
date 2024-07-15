import sdk, { EventDetails, EventListenerRegister, OnOff, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { AutomationJavascript } from "./builtins/javascript";
import { Listen } from "./builtins/listen";
import { Scheduler } from "./builtins/scheduler";
import { AutomationShellScript } from "./builtins/shellscript";
import { scryptedEval } from "./scrypted-eval";
import { automationActions } from "./automation-actions";
const { systemManager } = sdk;

interface Abort {
    aborted: boolean;
}

interface AutomationData {
    triggers: AutomationTrigger[],
    actions: AutomationAction[],
}

interface AutomationTrigger {
    id: string,
    condition?: string,
    model: any,
}
interface AutomationAction {
    id: string,
    model: any,
}

export class Automation extends ScryptedDeviceBase implements OnOff, Settings {
    registers: EventListenerRegister[] = [];
    pendings = new Map<string, Abort>();
    actionSettings: StorageSettings<any>[] = [];
    triggerSettings: StorageSettings<any>[] = [];
    storageSettings = new StorageSettings(this, {
        denoiseEvents: {
            title: 'Denoise Events',
            description: 'Denoising events will suppress events where the same event data is sent multiple times in a row. For example, if a sensor sent multiple door open events, only the first event will trigger this automation. The automation will fire again once the door sends a close event.',
            type: 'boolean',
        },
        runToCompletion: {
            title: 'Run Automations to Completion',
            description: 'By default, automations that are executing will reset if triggered by a new event. Check this box to require an automation to run to completion before it can be triggered again. This setting can be used in conjunction with a timer to prevent an automation from running too often.',
            type: 'boolean',
        },
        staticEvents: {
            title: 'Reset Automation on All Events',
            description: 'By default, running Automation timers will be reset if the same device fires the event again. Check this box to reset Automation timers on all of the configured events.',
            type: 'boolean',
        },
        data: {
            json: true,
            hide: true,
            defaultValue: {},
        }
    });
    data: AutomationData = this.storageSettings.values.data;

    constructor(nativeId: string) {
        super(nativeId);

        if (this.on === undefined)
            this.on = true;
        this.bind();
    }

    async getSettings(): Promise<Setting[]> {
        return [
            ...(await Promise.all(this.triggerSettings.map(s => s.getSettings()))).flat(),
            ...(await Promise.all(this.actionSettings.map(s => s.getSettings()))).flat(),
            ...await this.storageSettings.getSettings(),
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const allStorageSettings = [
            ...this.triggerSettings,
            ...this.actionSettings,
            this.storageSettings,
        ];
        for (const storageSettings of allStorageSettings) {
            if (storageSettings.keys[key]) {
                await storageSettings.putSetting(key, value);
                break;
            }
        }
        this.bind();
    }

    async eval(script: string, variables: { [name: string]: any }) {
        return (await scryptedEval(this, script, variables)).value;
    }

    async turnOff() {
        this.on = false;
        this.bind();
    }

    async turnOn() {
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
            const createTypeStorageSettings = (i: string, value: string) => {
                const index = parseInt(i);
                return new StorageSettings(this, {
                    [`type-${index}`]: {
                        title: 'Action Type',
                        choices: [
                            'Script',
                            'Shell Script',
                            'Wait',
                            'Update Plugins',
                            'Control Device',
                            'Remove Action',
                        ],
                        immediate: true,
                        mapGet: () => {
                            return value;
                        },
                        mapPut: (ov: string, value: string) => {
                            switch (value) {
                                case 'Script':
                                    this.data.actions[index].id = 'scriptable';
                                    break;
                                case 'Shell Script':
                                    this.data.actions[index].id = 'shell-scriptable';
                                    break;
                                case 'Wait':
                                    this.data.actions[index].id = 'timer';
                                    break;
                                case 'Update Plugins':
                                    this.data.actions[index].id = 'update-plugins';
                                    break;
                                case 'Control Device':
                                    this.data.actions[index].id = '';
                                    break;
                                case 'Remove Action':
                                    this.data.actions.splice(index, 1);
                                    break;
                            }
                            this.storageSettings.values.data = this.data;
                        },
                    }
                });
            }

            this.actionSettings = [];
            this.triggerSettings = []

            for (const [index, action] of Object.entries(this.data.actions)) {
                const stepActions : typeof this.actionSettings = [];
                const parts = action.id.split('#');
                const [id, iface] = parts;
                if (id === 'scriptable') {
                    stepActions.push(createTypeStorageSettings(index, 'Script'));

                    stepActions.push(new StorageSettings(this, {
                        [index]: {
                            title: 'Script',
                            description: 'The script to run when the automation is triggered.',
                            type: 'script',
                            mapGet() {
                                return action.model['script.ts'];
                            },
                            mapPut: (ov: any, value: any) => {
                                action.model['script.ts'] = value;
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));
                }
                else if (id === 'shell-scriptable') {
                    stepActions.push(createTypeStorageSettings(index, 'Shell Script'));

                    stepActions.push(new StorageSettings(this, {
                        [index]: {
                            title: 'Script',
                            description: 'The script to run when the automation is triggered.',
                            type: 'textarea',
                            mapGet() {
                                return action.model['script.sh'];
                            },
                            mapPut: (ov: any, value: any) => {
                                action.model['script.sh'] = value;
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));
                }
                else if (id === 'timer') {
                    stepActions.push(createTypeStorageSettings(index, 'Wait'));

                    stepActions.push(new StorageSettings(this, {
                        [index]: {
                            title: 'Seconds',
                            description: 'The number of seconds to wait before running the next action.',
                            type: 'number',
                            mapGet() {
                                return action.model.seconds;
                            },
                            mapPut: (ov: any, value: any) => {
                                action.model.seconds = value;
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));
                }
                else if (id === 'update-plugins') {
                    stepActions.push(createTypeStorageSettings(index, 'Update Plugins'));
                }
                else {
                    
                    const validInterfaces = [...automationActions.keys()];
                    const deviceFilter = `${JSON.stringify(validInterfaces)}.includes(deviceInterface)`;
                    stepActions.push(createTypeStorageSettings(index, 'Control Device'));
                    stepActions.push(new StorageSettings(this, {
                        [index]: {
                            title: 'Device',
                            description: 'The device to control when the automation is triggered.',
                            type: 'interface',
                            deviceFilter,
                            immediate: true,
                            mapGet() {
                                return action.id;
                            },
                            mapPut: (ov: any, value: any) => {
                                action.id = value;
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));

                    let actionSettings = automationActions.get(iface as ScryptedInterface)?.settings;
                    if (actionSettings) {
                        actionSettings = {
                            ...actionSettings,
                        };

                        for (const k in actionSettings) {
                            const a = actionSettings[k];
                            a.mapPut = (ov: any, value: any) => {
                                action.model[k] = value;
                            };
                            a.mapGet = () => {
                                return action.model[k];
                            };
                        }

                        stepActions.push(new StorageSettings(this, actionSettings));
                    }
                }

                for (const as of stepActions) {
                    for (const s of Object.values(as.settings)) {
                        s.subgroup = `Action ${parseInt(index) + 1}`
                    }
                }
                this.actionSettings.push(...stepActions);
            }

            this.triggerSettings.push(new StorageSettings(this, {
                addTrigger: {
                    title: 'Add Trigger',
                    description: 'Add a new trigger to the automation.',
                    type: 'button',
                    mapPut: () => {
                        this.data.triggers.push({
                            id: '',
                            model: {},
                        });
                        this.storageSettings.values.data = this.data;
                    }
                }
            }));

            this.actionSettings.push(new StorageSettings(this, {
                addAction: {
                    subgroup: `Action ${this.data.actions.length + 1}`,
                    title: 'Add Action',
                    description: 'Add a new action to the automation.',
                    type: 'button',
                    mapPut: () => {
                        this.data.actions.push({
                            id: '',
                            model: {},
                        });
                        this.storageSettings.values.data = this.data;
                    }
                }
            }));

            for (const as of this.actionSettings) {
                for (const s of Object.values(as.settings)) {
                    s.group = 'Actions';
                }
            }

            for (const ts of this.triggerSettings) {
                for (const s of Object.values(ts.settings)) {
                    s.group = 'Triggers';
                }
            }

            const { denoiseEvents, runToCompletion, staticEvents } = this.storageSettings.values;

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
                    for (const action of this.data.actions) {
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

            for (const trigger of this.data.triggers) {
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
