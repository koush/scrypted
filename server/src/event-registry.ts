import { EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterface, SystemDeviceState } from "@scrypted/sdk/types";

export class EventListenerRegisterImpl implements EventListenerRegister {
    removeListener: () => void;

    constructor(removeListener: () => void) {
        this.removeListener = removeListener;
    }
}

export class EventRegistry {
    systemListeners = new Set<(id: string, eventDetails: EventDetails, eventData: object) => void>();
    listeners: { [token: string]: Set<(eventDetails: EventDetails, eventData: object) => void> } = {};

    listen(EventListener: (id: string, eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
        const events = this.systemListeners;
        let cb = EventListener;
        events.add(cb);
        return new EventListenerRegisterImpl(() => {
            events.delete(cb);
            cb = undefined;
        });
    }

    listenDevice(id: string, options: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): EventListenerRegister {
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

        const eventDetails = {
            changed,
            eventInterface,
            eventTime,
            property,
        };

        // system listeners only get state changes.
        // there are many potentially noisy stateless events, like
        // object detection and settings changes.
        if (property) {
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
