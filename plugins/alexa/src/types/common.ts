import { EventDetails, HttpRequest, HttpResponse, ScryptedDevice, ScryptedDeviceType } from "@scrypted/sdk";
import {DiscoveryEndpoint, Directive} from 'alexa-smarthome-ts';

export type AlexaHandler = (request: HttpRequest, response: HttpResponse, directive: Directive) => Promise<void>
export type AlexaCapabilityHandler<T> = (request: HttpRequest, response: HttpResponse, directive: Directive, device: ScryptedDevice & T) => Promise<void>

export const supportedTypes = new Map<ScryptedDeviceType, SupportedType>();
export const capabilityHandlers = new Map<string, AlexaCapabilityHandler<any>>();

export interface EventReport {
    type: 'event';
    payload: any;
    namespace: string;
    name: string;
}

export interface StateReport {
    type: 'state';
    payload: any;
}

export interface SupportedType {
    probe(device: ScryptedDevice): Partial<DiscoveryEndpoint<any>>;
    reportState(eventSource: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<EventReport | StateReport>;
}

export function addSupportedType(type: ScryptedDeviceType, supportedType: SupportedType) {
    supportedTypes.set(type, supportedType);
}

export function isSupported(device: ScryptedDevice) {
    return supportedTypes.get(device.type)?.probe(device);
}
