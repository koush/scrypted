import { EventDetails, EventListenerOptions, EventListenerRegister, Refresh, ScryptedInterface, ScryptedInterfaceProperty, SystemDeviceState } from "@scrypted/types";
import throttle from 'lodash/throttle';
import { PluginDevice } from "./db-types";
import { EventListenerRegisterImpl, EventRegistry, getMixinEventName } from "./event-registry";
import { propertyInterfaces } from "./plugin/descriptor";
import { QueryInterfaceSymbol, RefreshSymbol } from "./plugin/plugin-device";
import { ScryptedRuntime } from "./runtime";
import { sleep } from "./sleep";

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

    async getImplementerId(pluginDevice: PluginDevice, eventInterface: ScryptedInterface | string) {
        if (!eventInterface)
            throw new Error(`ScryptedInterface is required`);

        const device = this.scrypted.getDevice(pluginDevice._id);
        if (!device)
            throw new Error(`device ${pluginDevice._id} not found?`);

        const implementerId: string = await (device as any)[QueryInterfaceSymbol](eventInterface);
        return implementerId;
    }

    async notifyInterfaceEventFromMixin(pluginDevice: PluginDevice, eventInterface: ScryptedInterface | string, value: any, mixinId: string) {
        // TODO: figure out how to clean this up this hack. For now,
        // Settings interface is allowed to bubble from mixin devices..

        // TODO: mixin masking of property-less events is disabled due to ObjectDetector.
        // Running opencv and tensorflow-lite masks one or the other object events.
        // Need to think this through more.
        if (false && eventInterface !== ScryptedInterface.Settings) {
            const implementerId = await this.getImplementerId(pluginDevice, eventInterface);
            if (implementerId !== mixinId) {
                const event = getMixinEventName({
                    event: eventInterface,
                    mixinId,
                });

                this.notifyEventDetails(pluginDevice._id, {
                    eventId: undefined,
                    eventInterface,
                    eventTime: Date.now(),
                    mixinId,
                }, value, event);

                return;
            }
        }

        this.notify(pluginDevice?._id, Date.now(), eventInterface, undefined, value);
    }

    async setPluginDeviceStateFromMixin(pluginDevice: PluginDevice, property: string, value: any, eventInterface: ScryptedInterface, mixinId: string) {
        // TODO: crashing here. send descriptor from python too.
        eventInterface = eventInterface || propertyInterfaces[property];

        const implementerId = await this.getImplementerId(pluginDevice, eventInterface);
        if (implementerId !== mixinId) {
            const event = getMixinEventName({
                event: eventInterface,
                mixinId,
            });
            this.scrypted.getDeviceLogger(pluginDevice).log('i', `${property}: ${value} (mixin)`);
            this.notifyEventDetails(pluginDevice._id, {
                eventId: undefined,
                eventInterface,
                eventTime: Date.now(),
                mixinId,
                property,
            }, value, event);
            return false;
        }

        return this.setPluginDeviceState(pluginDevice, property, value, eventInterface);
    }

    setPluginDeviceState(device: PluginDevice, property: string, value: any, eventInterface?: ScryptedInterface) {
        eventInterface = eventInterface || propertyInterfaces[property];
        if (!eventInterface)
            throw new Error(`eventInterface must be provided`);

        const changed = setState(device, property, value);

        if (eventInterface !== ScryptedInterface.ScryptedDevice) {
            if (this.notify(device?._id, Date.now(), eventInterface, property, value, { changed }) && device) {
                this.scrypted.getDeviceLogger(device).log('i', `${property}: ${value}`);
            }
        }

        this.upserts.add(device._id);
        this.upsertThrottle();

        return changed;
    }

    updateDescriptor(device: PluginDevice) {
        this.notify(device._id, undefined, ScryptedInterface.ScryptedDevice, undefined, device.state, { changed: true });
    }

    removeDevice(id: string) {
        this.notify(undefined, undefined, ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, { changed: true });
    }

    notifyInterfaceEvent(device: PluginDevice, eventInterface: ScryptedInterface | string, value: any, mixinId?: string) {
        this.notify(device?._id, Date.now(), eventInterface, undefined, value, {
            changed: true,
            mixinId,
        });
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
            callback?.(eventDetails, eventData);
        };

        const wrappedRegister = super.listenDevice(id, options, cb);

        return new EventListenerRegisterImpl(() => {
            wrappedRegister.removeListener();
            cb = undefined;
            callback = undefined;
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
    // device may have been deleted.
    if (!pluginDevice.state)
        return;
    if (!pluginDevice.state[property])
        pluginDevice.state[property] = {};
    const state = pluginDevice.state[property];
    const changed = !isSameValue(value, state.value);
    state.value = value;
    return changed;
}

export function getState(pluginDevice: PluginDevice, property: string): any {
    const ret = pluginDevice.state?.[property]?.value;
    if (typeof ret === 'object')
        return JSON.parse(JSON.stringify(ret));
    return ret;
}
