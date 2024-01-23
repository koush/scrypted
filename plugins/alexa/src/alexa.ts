export declare type DisplayCategory = 'ACTIVITY_TRIGGER' | 'CAMERA' | 'CONTACT_SENSOR' | 'DOOR' | 'DOORBELL' | 'GARAGE_DOOR' | 'LIGHT' | 'MICROWAVE' | 'MOTION_SENSOR' | 'OTHER' | 'SCENE_TRIGGER' | 'SECURITY_PANEL' | 'SMARTLOCK' | 'SMARTPLUG' | 'SPEAKER' | 'SWITCH' | 'TEMPERATURE_SENSOR' | 'THERMOSTAT' | 'TV' | 'FAN';

/*
COMMON DIRECTIVES AND RESPONSES
*/

export interface AddOrUpdateReport {
    event: {
        header: Header<"Alexa.Discovery", "AddOrUpdateReport">;
        payload: AddOrUpdateReportPayload;
    }
}

export interface DeleteReport {
    event: {
        header: Header<"Alexa.Discovery", "DeleteReport">;
        payload: DeleteReportPayload;
    }
}

export interface StateReport extends Report<"Alexa", "StateReport"> { }

export interface ChangeReport extends Report<"Alexa", "ChangeReport", ChangePayload> { }

export interface Response {
    event: Event<"Alexa", "Response">;
    context?: Context;
}

export interface DeferredResponse {
    event: Event<"Alexa", "DeferredResponse", DeferredPayload>;
}

export interface ErrorResponse {
    event: Event<"Alexa", "ErrorResponse", ErrorPayload>;
}

/*
DEVICE EVENTS
*/

export interface WebRTCAnswerGeneratedForSessionEvent extends Report<"Alexa.RTCSessionController", "AnswerGeneratedForSession", WebRTCAnswerGeneratedForSessionPayload> { }

export interface WebRTCSessionConnectedEvent extends Report<"Alexa.RTCSessionController", "SessionConnected", WebRTCSessionPayload> { }

export interface WebRTCSessionDisconnectedEvent extends Report<"Alexa.RTCSessionController", "SessionDisconnected", WebRTCSessionPayload> { }

export interface ObjectDetectionEvent extends Report<"Alexa.SmartVision.ObjectDetectionSensor", "ObjectDetection", ObjectDetectionPayload> { }

export interface DoorbellPressEvent extends Report<"Alexa.DoorbellEventSource", "DoorbellPress", DoorbellPressPayload> { }

/*
IMPLIMENTATION TYPES
*/


export interface Header<NS = string, N = string> {
    namespace: NS;
    name: N;
    messageId: string;
    correlationToken?: string;
    payloadVersion: string;
}

export interface Scope {
    type: string;
    token: string;
    partition?: string;
    userId?: string;
}

export interface Endpoint {
    endpointId: string;
    scope?: Scope;
    cookie?: any;
}

export interface Payload { }

export interface Directive<NS = string, N = string, P = Payload> {
    header: Header<NS, N>;
    endpoint: Endpoint;
    payload: P;
}

export interface Event<NS = string, N = string, P = Payload> { 
    header: Header<NS, N>;
    endpoint: Endpoint;
    payload: P;
}

export interface Property {
    namespace: string;
    instance?: string;
    name: string;
    value: any;
    timeOfSample: string;
    uncertaintyInMilliseconds?: number;
}

export interface Context {
    properties: Property[];
}

export interface Report<NS = string, N = string, P = Payload> {
    event: Event<NS, N, P>;
    context: Context;
}

export interface DeferredPayload {
    estimatedDeferralInSeconds: number;
}

export interface ErrorPayload {
    type: string;
    message: string;
}

export interface ChangePayload extends Payload {
    change: {
        cause: {
            type: "APP_INTERACTION" | "PERIODIC_POLL" | "PHYSICAL_INTERACTION" | "VOICE_INTERACTION" | "RULE_TRIGGER";
        },
        properties: Property[];
    }
}

export interface WebRTCSessionPayload {
    sessionId: string;
}

export interface WebRTCAnswerGeneratedForSessionPayload {
    answer: {
        format: string;
        value: string;
    }
}

export interface ObjectDetectionPayloadEvent {
    eventIdenifier: string;
    imageNetClass: string;
    timeOfSample: string;
    uncertaintyInMilliseconds: number;
    objectIdentifier: string;
    frameImageUri: string;
    croppedImageUri: string;
}

export interface ObjectDetectionPayload {
    events: ObjectDetectionPayloadEvent[]
}


export interface DoorbellPressPayload {
    cause: {
        type: "APP_INTERACTION" | "PERIODIC_POLL" | "PHYSICAL_INTERACTION" | "VOICE_INTERACTION";
    },
    timestamp: string;
}

export interface DiscoveryProperty {
    supported: any[];
    proactivelyReported: boolean;
    retrievable: boolean;
}

export interface DiscoveryCapability {
    type: string;
    interface: string;
    instance?: string;
    version: string;
    properties?: DiscoveryProperty;
    capabilityResources?: any;
    configuration?: any;
    semantics?: any;
}

export interface DiscoveryEndpoint {
    endpointId: string;
    manufacturerName: string;
    description: string;
    friendlyName: string;
    displayCategories: DisplayCategory[];
    additionalAttributes?: {
        "manufacturer"?: string;
        "model"?: string;
        "serialNumber"?: string;
        "firmwareVersion"? : string;
        "softwareVersion"?: string;
        "customIdentifier"?: string;
    };
    capabilities?: DiscoveryCapability[];
    connections?: any[];
    relationships?: any;
    cookie?: any;
}

export interface DiscoverPayload {
    endpoints: DiscoveryEndpoint[]
}

export interface Discovery {
    event: {
        header: Header<"Alexa.Discovery", "Discover.Response">;
        payload: DiscoverPayload;
    }
}

export interface AddOrUpdateReportPayload {
    endpoints: DiscoveryEndpoint[]
    scope: Scope;
}

export interface DeleteReportEndpoint {
    endpointId: string;
}

export interface DeleteReportPayload {
    endpoints: DeleteReportEndpoint[]
    scope: Scope;
}