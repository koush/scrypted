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

        this.data.actions ||= [];
        this.data.triggers ||= [];

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
            const createTriggerTypeStorageSettings = (i: string, value: string) => {
                const index = parseInt(i);
                return new StorageSettings(this, {
                    [`trigger-type-${index}`]: {
                        title: 'Trigger Type',
                        choices: [
                            'Scheduler',
                            'Device Event',
                            'Remove Trigger',
                        ],
                        immediate: true,
                        mapGet: () => {
                            return value;
                        },
                        mapPut: (ov: string, value: string) => {
                            switch (value) {
                                case 'Device Event':
                                    this.data.triggers[index].id = '';
                                    break;
                                case 'Scheduler':
                                    this.data.triggers[index].id = 'scheduler';
                                    break;
                                case 'Remove Trigger':
                                    this.data.triggers.splice(index, 1);
                                    break;
                            }
                            this.storageSettings.values.data = this.data;
                        },
                    }
                });
            };

            const createActionTypeStorageSettings = (i: string, value: string) => {
                const index = parseInt(i);
                return new StorageSettings(this, {
                    [`action-type-${index}`]: {
                        title: 'Action Type',
                        choices: [
                            'Script',
                            'Shell Script',
                            'Wait',
                            'Update Plugins',
                            'Device Action',
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
                                case 'Device Action':
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

            for (const [index, trigger] of Object.entries(this.data.triggers)) {
                const stepTriggers: typeof this.triggerSettings = [];
                const parts = trigger.id.split('#');
                const [id,] = parts;
                if (id === 'scheduler') {
                    stepTriggers.push(createTriggerTypeStorageSettings(index, 'Scheduler'));

                    stepTriggers.push(new StorageSettings(this, {
                        [`trigger-day-${index}`]: {
                            title: 'Day',
                            type: 'day',
                            multiple: true,
                            mapGet() {

                                const days: number[] = [];
                                if (trigger?.model.sunday)
                                    days.push(0);
                                if (trigger?.model.monday)
                                    days.push(1);
                                if (trigger?.model.tuesday)
                                    days.push(2);
                                if (trigger?.model.wednesday)
                                    days.push(3);
                                if (trigger?.model.thursday)
                                    days.push(4);
                                if (trigger?.model.friday)
                                    days.push(5);
                                if (trigger?.model.saturday)
                                    days.push(6);

                                return days;
                            },
                            mapPut: (ov: any, value: any) => {
                                trigger.model.sunday = value.includes(0);
                                trigger.model.monday = value.includes(1);
                                trigger.model.tuesday = value.includes(2);
                                trigger.model.wednesday = value.includes(3);
                                trigger.model.thursday = value.includes(4);
                                trigger.model.friday = value.includes(5);
                                trigger.model.saturday = value.includes(6);

                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));

                    stepTriggers.push(new StorageSettings(this, {
                        [`trigger-time-${index}`]: {
                            title: 'Time',
                            type: 'time',
                            mapGet() {
                                const date = new Date();
                                date.setHours(trigger.model.hour);
                                date.setMinutes(trigger.model.minute);
                                return date.getTime();
                            },
                            mapPut: (ov: any, value: any) => {
                                const date = new Date(value);
                                trigger.model.hour = date.getHours();
                                trigger.model.minute = date.getMinutes();
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));
                }
                else {
                    stepTriggers.push(createTriggerTypeStorageSettings(index, 'Device Event'));

                    stepTriggers.push(new StorageSettings(this, {
                        [`trigger-${index}`]: {
                            title: 'Device Event',
                            description: 'The event to trigger the automation.',
                            type: 'interface',
                            mapGet() {
                                return trigger.id;
                            },
                            mapPut: (ov: any, value: any) => {
                                trigger.id = value;
                                this.storageSettings.values.data = this.data;
                            },
                        }
                    }));
                }

                stepTriggers.push(new StorageSettings(this, {
                    [`trigger-condition-${index}`]: {
                        title: 'Trigger Condition (optional)',
                        description: 'A JavaScript condition to evaluate before running the automation. If the condition is false, the automation will not run. The eventData variable contains the event payload.',
                        placeholder: 'MotionSensor example: eventData === true',
                        mapGet() {
                            return trigger.condition;
                        },
                        mapPut: (ov: any, value: any) => {
                            trigger.condition = value;
                            this.storageSettings.values.data = this.data;
                        },
                    }
                }));

                for (const ts of stepTriggers) {
                    for (const s of Object.values(ts.settings)) {
                        s.subgroup = `Trigger ${parseInt(index) + 1}`
                    }
                }
                this.triggerSettings.push(...stepTriggers);
            }

            for (const [index, action] of Object.entries(this.data.actions || [])) {
                const stepActions: typeof this.actionSettings = [];
                const parts = action.id.split('#');
                const [id, iface] = parts;
                if (id === 'scriptable') {
                    stepActions.push(createActionTypeStorageSettings(index, 'Script'));

                    stepActions.push(new StorageSettings(this, {
                        [`action-${index}`]: {
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
                    stepActions.push(createActionTypeStorageSettings(index, 'Shell Script'));

                    stepActions.push(new StorageSettings(this, {
                        [`action-${index}`]: {
                            title: 'Shell Script',
                            description: 'The shell script to run when the automation is triggered.',
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
                    stepActions.push(createActionTypeStorageSettings(index, 'Wait'));

                    stepActions.push(new StorageSettings(this, {
                        [`action-${index}`]: {
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
                    stepActions.push(createActionTypeStorageSettings(index, 'Update Plugins'));
                }
                else {

                    const validInterfaces = [...automationActions.keys()];
                    const deviceFilter = `${JSON.stringify(validInterfaces)}.includes(deviceInterface)`;
                    stepActions.push(createActionTypeStorageSettings(index, 'Device Action'));
                    stepActions.push(new StorageSettings(this, {
                        [`action-${index}`]: {
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
                        const cloned = JSON.parse(JSON.stringify(actionSettings));
                        actionSettings = {};

                        for (const k of Object.keys(cloned)) {
                            const a = cloned[k];
                            actionSettings[`action-${index}-${k}`] = a;

                            a.mapPut = (ov: any, value: any) => {
                                action.model[k] = value;
                                this.storageSettings.values.data = this.data;
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
                    subgroup: `Trigger ${this.data.triggers.length + 1}`,
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
                        const [id, iface] = parts;

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
                                throw new Error(`unknown device ${id}`);

                            const runner = automationActions.get(iface as ScryptedInterface);
                            if (!runner)
                                throw new Error(`unknown action ${iface}`);

                            runner.invoke(device, action.model).catch(e => this.console.error('automation aciton failed', action.model, e));
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
                    let scheduler: Scheduler;
                    if (id === 'scheduler') {
                        scheduler = new Scheduler();
                    }
                    else {
                        throw new Error(`unknown action ${trigger.id}`);
                    }

                    listen = scheduler.schedule(trigger.model);
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
