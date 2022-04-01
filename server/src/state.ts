import { ScryptedRuntime } from "./runtime";
import { ScryptedNativeId, EventDetails, EventListenerOptions, EventListenerRegister, Refresh, ScryptedInterface, ScryptedInterfaceProperty, SystemDeviceState } from "@scrypted/types";
import { RefreshSymbol } from "./plugin/plugin-device";
import throttle from 'lodash/throttle';
import { sleep } from "./sleep";
import { EventListenerRegisterImpl, EventRegistry } from "./event-registry";
import { PluginDevice } from "./db-types";
import { allInterfaceProperties, propertyInterfaces } from "./plugin/descriptor";

export class ScryptedStateManager extends EventRegistry {
    scrypted: ScryptedRuntime;
    upserts = new Set<string>();
    upsertThrottle = throttle(() => {
        const ids = [...this.upserts.values()];
        this.upserts.clear();
        for (const id of ids) {
            try {
                const pluginDevice = this.scrypted.findPluginDeviceById(id);
                // may have been deleted
                if (pluginDevice)
                    this.scrypted.datastore.upsert(pluginDevice);
            }
            catch (e) {
                console.error('save state error', e);
            }
        }
    }, 30000, {
        leading: false,
        trailing: true,
    });

    constructor(scrypted: ScryptedRuntime) {
        super();
        this.scrypted = scrypted;
    }

    setPluginState(pluginId: string, nativeId: ScryptedNativeId, property: string, value: any) {
        const device = this.scrypted.findPluginDevice(pluginId, nativeId);
        if (!device)
            throw new Error(`device not found for plugin id ${pluginId} native id ${nativeId}`);
        this.setPluginDeviceState(device, property, value);
    }

    setPluginDeviceState(device: PluginDevice, property: string, value: any) {
        if (!allInterfaceProperties.includes(property))
            throw new Error(`invalid property ${property}`);

        // this currently doesn't work because inherited properties are not detected.
        // ie, MediaPlayer implements StartStop and Pause
        // if (!isValidInterfaceProperty(device.state.interfaces.value, property))
        //     throw new Error(`interface for property ${property} not implemented`);
        if (!allInterfaceProperties.includes(property))
            throw new Error(`${property} is not a valid property`);

        const changed = setState(device, property, value);

        this.notifyPropertyEvent(device, property, value, changed);

        this.upserts.add(device._id);
        this.upsertThrottle();

        return changed;
    }

    notifyPropertyEvent(device: PluginDevice, property: string, value: any, changed?: boolean) {
        const eventTime = device?.state?.[property]?.lastEventTime;
        const eventInterface = propertyInterfaces[property];

        if (this.notify(device?._id, eventTime, eventInterface, property, value, changed) && device) {
            this.scrypted.getDeviceLogger(device).log('i', `state change: ${property} ${value}`);
        }
    }

    updateDescriptor(device: PluginDevice) {
        this.notify(device._id, undefined, ScryptedInterface.ScryptedDevice, undefined, device.state, true);
    }

    removeDevice(id: string) {
        this.notify(undefined, undefined, ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, true);
    }

    notifyInterfaceEvent(device: PluginDevice, eventInterface: ScryptedInterface | string, value: any) {
        this.notify(device?._id, Date.now(), eventInterface, undefined, value, true);
    }

    setState(id: string, property: string, value: any) {
        const device = this.scrypted.pluginDevices[id];
        if (!device)
            throw new Error(`device not found for id ${id}`);

        return this.setPluginDeviceState(device, property, value);
    }

    getSystemState(): { [id: string]: { [property: string]: SystemDeviceState } } {
        const systemState: { [id: string]: { [property: string]: SystemDeviceState } } = {};
        for (const pluginDevice of Object.values(this.scrypted.pluginDevices)) {
            systemState[pluginDevice._id] = pluginDevice.state;
        }
        return systemState;
    }

    listenDevice(id: string, options: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
        let { denoise, event, watch } = (options || {}) as EventListenerOptions;
        if (!event && typeof options === 'string')
            event = options as string;
        if (!event)
            event = undefined;
        let polling = true;

        const device: any = this.scrypted.getDevice<Refresh>(id);
        if (device.interfaces.includes(ScryptedInterface.Refresh)) {
            (async () => {
                while (polling && !watch) {
                    // listen is not user initiated. an explicit refresh call would be.
                    try {
                        await this.refresh(id, event, false)
                    }
                    catch (e) {
                        console.error('refresh ended by exception', e);
                        break;
                    }
                }
            })();
        }

        let lastData: any = undefined;
        let cb = (eventDetails: EventDetails, eventData: any) => {
            if (denoise && lastData === eventData)
                return;
            callback(eventDetails, eventData);
        };

        const wrappedRegister = super.listenDevice(id, options, cb);

        return new EventListenerRegisterImpl(() => {
            wrappedRegister.removeListener();
            cb = undefined;
            polling = false;
        });
    }

    refreshThrottles: { [id: string]: RefreshThrottle } = {};
    getOrCreateRefreshThrottle(id: string, refreshInterface: string, userInitiated: boolean): RefreshThrottle {
        let throttle = this.refreshThrottles[id];
        if (throttle) {
            if (userInitiated)
                throttle.userInitiated = true;
            if (throttle.refreshInterface !== refreshInterface)
                throttle.refreshInterface = undefined;
            throttle.tailRefresh = true;
            return throttle;
        }

        const device: any = this.scrypted.getDevice<Refresh>(id);
        const logger = this.scrypted.getDeviceLogger(this.scrypted.findPluginDeviceById(id));

        if (!device.interfaces.includes(ScryptedInterface.Refresh))
            throw new Error('device does not implement refresh');

        // further refreshes will block
        const ret: RefreshThrottle = this.refreshThrottles[id] = {
            promise: (async () => {
                let timeout = 30000;
                try {
                    timeout = await device.getRefreshFrequency() * 1000;
                }
                catch (e) {
                }

                await sleep(timeout);
                try {
                    const rt = this.refreshThrottles[id];
                    if (!rt.tailRefresh)
                        return;
                    await device[RefreshSymbol](rt.refreshInterface, rt.userInitiated);
                }
                catch (e) {
                    logger.log('e', 'Refresh failed');
                    logger.log('e', e.toString());
                }
                finally {
                    delete this.refreshThrottles[id];
                }
            })(),
            userInitiated,
            refreshInterface,
            tailRefresh: false,
        }

        // initial refresh does not block
        const promise = device[RefreshSymbol](ret.refreshInterface, ret.userInitiated);

        return {
            promise,
            refreshInterface,
            userInitiated,
            tailRefresh: false,
        }
    }

    async refresh(id: string, refreshInterface: string, userInitiated: boolean): Promise<void> {
        const throttle = this.getOrCreateRefreshThrottle(id, refreshInterface, userInitiated);
        return throttle.promise;
    }
}

interface RefreshThrottle {
    promise: Promise<void>;
    refreshInterface: string;
    userInitiated: boolean;
    tailRefresh: boolean;
}

function isSameValue(value1: any, value2: any) {
    return value1 === value2 || JSON.stringify(value1) === JSON.stringify(value2);
}

export function setState(pluginDevice: PluginDevice, property: string, value: any): boolean {
    if (!pluginDevice.state[property])
        pluginDevice.state[property] = {};
    const state = pluginDevice.state[property];
    const now = Date.now();
    const changed = !isSameValue(value, state.value);
    if (changed)
        state.stateTime = now;
    state.value = value;
    state.lastEventTime = now;
    return changed;
}

export function getState(pluginDevice: PluginDevice, property: string): any {
    const ret = pluginDevice.state?.[property]?.value;
    if (typeof ret === 'object')
        return JSON.parse(JSON.stringify(ret));
    return ret;
}
