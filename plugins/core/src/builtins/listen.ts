import { EventDetails, EventListenerOptions, EventListenerRegister, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";

export interface Listen {
    listen(event: ScryptedInterface|string|EventListenerOptions, callback: (eventSource: ScryptedDevice|null, eventDetails: EventDetails, eventData: any) => void, source?: ScryptedDeviceBase): EventListenerRegister;
}
