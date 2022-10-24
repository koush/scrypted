import { EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterface, SystemDeviceState } from "@scrypted/types";
import crypto from 'crypto';

export class EventListenerRegisterImpl implements EventListenerRegister {
    removeListener: () => void;

    constructor(removeListener: () => void) {
        this.removeListener = removeListener;
    }
}

// todo: storage should only go to host plugin
const allowedEventInterfaces = new Set<string>([ScryptedInterface.ScryptedDevice, 'Logger', 'Storage'])

export class EventRegistry {
    systemListeners = new Set<(id: string, eventDetails: EventDetails, eventData: any) => void>();
    listeners: { [token: string]: Set<(eventDetails: EventDetails, eventData: any) => void> } = {};

    listen(callback: (id: string, eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
        const events = this.systemListeners;
        events.add(callback);
        return new EventListenerRegisterImpl(() => {
            events.delete(callback);
            callback = undefined;
        });
    }

    listenDevice(id: string, options: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: any) => void): EventListenerRegister {
        let { event } = (options || {}) as EventListenerOptions;
        if (!event && typeof options === 'string')
            event = options as string;
        if (!event)
            event = undefined;
        const token = `${id}#${event}`;
        let events = this.listeners[token];
        if (!events) {
            events = new Set();
            this.listeners[token] = events;
        }

        events.add(callback);
        return new EventListenerRegisterImpl(() => {
            events.delete(callback);
            callback = undefined;
        });
    }

    notify(id: string|undefined, eventTime: number, eventInterface: string, property: string|undefined, value: any, changed?: boolean): boolean {
        // prevent property event noise
        if (property && !changed)
            return false;

        const eventDetails: EventDetails = {
            eventId: crypto.randomBytes(8).toString("base64"),
            changed,
            eventInterface,
            eventTime,
            property,
        };

        // system listeners only get state changes.
        // there are many potentially noisy stateless events, like
        // object detection and settings changes.
        if (property || allowedEventInterfaces.has(eventInterface)) {
            for (const event of this.systemListeners) {
                event(id, eventDetails, value);
            }
        }

        const events = this.listeners[`${id}#${eventInterface}`];
        if (events) {
            for (const event of events) {
                event(eventDetails, value);
            }
        }

        const allEvents = this.listeners[`${id}#${undefined}`];
        if (allEvents) {
            for (const event of allEvents) {
                event(eventDetails, value);
            }
        }

        return true;
    }
}
