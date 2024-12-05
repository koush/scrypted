import { EventDetails, EventListenerOptions, EventListenerRegister, ScryptedInterface } from "@scrypted/types";

export class EventListenerRegisterImpl implements EventListenerRegister {
    removeListener: () => void;

    constructor(removeListener: () => void) {
        this.removeListener = removeListener;
    }
}

export function getMixinEventName(options: string | EventListenerOptions) {
    let { event, mixinId } = (options || {}) as EventListenerOptions;
    if (!event && typeof options === 'string')
        event = options as string;
    if (!event)
        event = undefined;
    if (!mixinId)
        return event;
    let ret = `${event}-mixin-${mixinId}`;
    return ret;
}

// todo: storage should only go to host plugin
const allowedEventInterfaces = new Set<string>([ScryptedInterface.ScryptedDevice, 'Logger'])

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
        let event = getMixinEventName(options)
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

    notify(id: string | undefined, eventTime: number, eventInterface: string, property: string | undefined, value: any, options?: {
        changed?: boolean;
        mixinId?: string;
    }): boolean {
        const { changed, mixinId } = options || {};
        // prevent property event noise
        if (property && !changed)
            return false;

        const eventDetails: EventDetails = {
            eventId: undefined,
            eventInterface,
            eventTime,
            property,
            mixinId,
        };

        return this.notifyEventDetails(id, eventDetails, value);
    }

    notifyEventDetails(id: string | undefined, eventDetails: EventDetails, value: any, eventInterface?: string) {
        eventDetails.eventId ||= Math.random().toString(36).substring(2);
        eventInterface ||= eventDetails.eventInterface;

        // system listeners only get state changes.
        // there are many potentially noisy stateless events, like
        // object detection and settings changes.
        if ((eventDetails.property && !eventDetails.mixinId) || allowedEventInterfaces.has(eventInterface)) {
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
