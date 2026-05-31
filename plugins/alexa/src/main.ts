import axios from 'axios';
import sdk, { HttpRequest, HttpRequestHandler, MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, EventDetails, Setting, SettingValue, Settings, HttpResponseOptions, HttpResponse } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { addBattery, addOnline, deviceErrorResponse, mirroredResponse, authErrorResponse, AlexaHttpResponse } from './common';
import { supportedTypes } from './types';
import { v4 as createMessageId } from 'uuid';
import { ChangeReport, Discovery, DiscoveryEndpoint } from './alexa';
import { alexaHandlers, alexaDeviceHandlers } from './handlers';

const { systemManager, deviceManager } = sdk;

const client_id = "amzn1.application-oa2-client.3283807e04d8408eb44a698c10f9dd13";
const client_secret = "bed445e2b26730acd818b90e175b275f6b67b18ff8645e571c5b3e311fa75ee9";
const includeToken = 4;

export let DEBUG = false;

function debug(...args: any[]) {
    if (DEBUG)
        console.debug(...args);
}

class AlexaPlugin extends ScryptedDeviceBase implements HttpRequestHandler, MixinProvider, Settings {
    storageSettings = new StorageSettings(this, {
        tokenInfo: {
            hide: true,
            json: true
        },
        syncedDevices: {
            defaultValue: [],
            multiple: true,
            hide: true
        },
        defaultIncluded: {
            hide: true,
            json: true
        },
        apiEndpoint: {
            title: 'Alexa Endpoint',
            description: 'This is the endpoint Alexa will use to send events to. This is set after you login.',
            type: 'string',
            readonly: true
        },
        debug: {
            title: 'Debug Events',
            description: 'Log all events to the console. This will be very noisy and should not be left enabled.',
            type: 'boolean',
            onPut(oldValue: boolean, newValue: boolean) {
                DEBUG = newValue;
            }
        },
        pairedUserId: {
            title: "Pairing Key",
            description: "The pairing key used to validate requests from Alexa. Clear this key or delete the plugin to allow pairing with a different Alexa login.",
        },
        disableAutoAdd: {
            title: "Disable auto add",
            description: "Disable automatic enablement of devices.",
            type: 'boolean',
            defaultValue: false,
        },
    });

    accessToken: Promise<string>;
    validAuths = new Set<string>();
    devices = new Map<string, ScryptedDevice>();

    constructor(nativeId?: string) {
        super(nativeId);

        DEBUG = this.storageSettings.values.debug ?? false;

        alexaHandlers.set('Alexa.Authorization/AcceptGrant', this.onAlexaAuthorization);
        alexaHandlers.set('Alexa.Discovery/Discover', this.onDiscoverEndpoints);

        this.start()
            .catch(e => {
                this.console.error('startup failed', e);
            })
    }

    async start() {

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            await this.tryEnableMixin(device);
        }

        systemManager.listen((async (eventSource: ScryptedDevice | undefined, eventDetails: EventDetails, eventData: any) => {
            const status = await this.tryEnableMixin(eventSource);

            // sync new devices when added or removed
            if (status === DeviceMixinStatus.Setup)
                await this.syncEndpoints();

            if (status === DeviceMixinStatus.Setup || status === DeviceMixinStatus.AlreadySetup) {

                if (!this.devices.has(eventSource.id)) {
                    this.devices.set(eventSource.id, eventSource);
                    eventSource.listen(ScryptedInterface.ObjectDetector, this.deviceListen.bind(this));
                }

                this.deviceListen(eventSource, eventDetails, eventData);
            }
        }).bind(this));

        await this.syncEndpoints();
    }

    private async tryEnableMixin(device: ScryptedDevice): Promise<DeviceMixinStatus> {
        if (!device)
            return DeviceMixinStatus.NotSupported;

        const mixins = (device.mixins || []).slice();
        if (mixins.includes(this.id))
            return DeviceMixinStatus.AlreadySetup;

        const defaultIncluded = this.storageSettings.values.defaultIncluded || {};
        if (defaultIncluded[device.id] === includeToken)
            return DeviceMixinStatus.AlreadySetup;

        if (!supportedTypes.has(device.type))
            return DeviceMixinStatus.NotSupported;

        if (this.storageSettings.values.disableAutoAdd) {
            return DeviceMixinStatus.Skip;
        }

        mixins.push(this.id);

        const plugins = await systemManager.getComponent('plugins');
        await plugins.setMixins(device.id, mixins);

        defaultIncluded[device.id] = includeToken;
        this.storageSettings.values.defaultIncluded = defaultIncluded;

        return DeviceMixinStatus.Setup;
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        const available = supportedTypes.has(type);

        if (available)
            return [];

        return;
    }

    async getMixin(device: ScryptedDevice, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }): Promise<any> {
        return device;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        const device = systemManager.getDeviceById(id);
        const mixins = (device.mixins || []).slice();
        if (mixins.includes(this.id))
            return;

        this.log.i(`Device removed from Alexa: ${device.name}. Requesting sync.`);
        await this.syncEndpoints();
    }

    async deviceListen(eventSource: ScryptedDevice | undefined, eventDetails: EventDetails, eventData: any): Promise<void> {
        if (!eventSource)
            return;

        if (!this.storageSettings.values.syncedDevices.includes(eventSource.id))
            return;

        if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice)
            return;

        const supportedType = supportedTypes.get(eventSource.type);
        if (!supportedType)
            return;

        let report = await supportedType.sendEvent(eventSource, eventDetails, eventData);

        if (!report && eventDetails.eventInterface === ScryptedInterface.Online) {
            report = {};
        }

        if (!report && eventDetails.eventInterface === ScryptedInterface.Battery) {
            report = {};
        }

        if (!report) {
            debug(`${eventDetails.eventInterface}.${eventDetails.property} not supported for device ${eventSource.type}`);
            return;
        }

        debug("event", eventDetails.eventInterface, eventDetails.property, eventSource.type);

        let data = {
            "event": {
                "header": {
                    "messageId": createMessageId(),
                    "namespace": report?.event?.header?.namespace ?? "Alexa",
                    "name": report?.event?.header?.name ?? "ChangeReport",
                    "payloadVersion": "3"
                },
                "endpoint": {
                    "endpointId": eventSource.id,
                },
                payload: report?.event?.payload
            },
            context: report?.context
        } as ChangeReport;

        data = addOnline(data, eventSource);
        data = addBattery(data, eventSource);

        // nothing to report
        if (data.context === undefined && data.event.payload === undefined)
            return;

        data = await this.addAccessToken(data);

        await this.postEvent(data);
    }

    private async addAccessToken(data: any): Promise<any> {
        const accessToken = await this.getAccessToken();

        if (data.event === undefined)
            data.event = {};

        if (data.event.endpoint === undefined)
            data.event.endpoint = [];

        data.event.endpoint.scope = {
            "type": "BearerToken",
            "token": accessToken,
        };

        return data;
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    readonly endpoints: string[] = [
        'api.amazonalexa.com',
        'api.eu.amazonalexa.com',
        'api.fe.amazonalexa.com'
    ];

    async getAlexaEndpoint(): Promise<string> {
        if (this.storageSettings.values.apiEndpoint)
            return this.storageSettings.values.apiEndpoint;

        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.get(`https://${this.endpoints[0]}/v1/alexaApiEndpoint`, {
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                }
            });

            const endpoint: string = response.data.endpoints[0];
            this.storageSettings.values.apiEndpoint = endpoint;
            return endpoint;
        } catch (err) {
            this.console.error(err);

            // default to NA/RoW endpoint if we can't get the endpoint.
            return this.endpoints[0];
        }
    }

    async postEvent(data: any) {
        const accessToken = await this.getAccessToken();
        const endpoint = await this.getAlexaEndpoint();
        const self = this;

        debug("send event to alexa", data);

        return axios.post(`https://${endpoint}/v3/events`, data, {
            headers: {
                'Authorization': 'Bearer ' + accessToken,
            }
        }).catch(error => {
            self.console.error(error?.response?.data);

            if (error?.response?.status === 401 || error?.response?.status === 403) {
                self.storageSettings.values.tokenInfo = undefined;
                self.accessToken = undefined;
            }
        });
    }

    async getEndpoints(): Promise<DiscoveryEndpoint[]> {
        const endpoints: DiscoveryEndpoint[] = [];

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);

            if (!device.mixins?.includes(this.id))
                continue;

            const endpoint = await this.getEndpointForDevice(device);
            if (endpoint)
                endpoints.push(endpoint);
        }

        return endpoints;
    }

    async onDiscoverEndpoints(request: HttpRequest, response: AlexaHttpResponse, directive: any) {
        const endpoints = await this.getEndpoints();

        const data = {
            "event": {
                "header": {
                    "namespace": 'Alexa.Discovery',
                    "name": 'Discover.Response',
                    "payloadVersion": '3',
                    "messageId": createMessageId()
                },
                "payload": {
                    endpoints
                }
            }
        } as Discovery;

        response.send(data);

        await this.saveEndpoints(endpoints);
    }

    async syncEndpoints() {
        const endpoints = await this.getEndpoints();

        if (!endpoints.length)
            return [];

        const accessToken = await this.getAccessToken();
        const data = {
            "event": {
                "header": {
                    "namespace": "Alexa.Discovery",
                    "name": "AddOrUpdateReport",
                    "payloadVersion": "3",
                    "messageId": createMessageId()
                },
                "payload": {
                    endpoints,
                    "scope": {
                        "type": "BearerToken",
                        "token": accessToken,
                    }
                }
            }
        };

        await this.postEvent(data);

        await this.saveEndpoints(endpoints);
    }

    async saveEndpoints(endpoints: DiscoveryEndpoint[]) {
        const existingEndpoints: string[] = this.storageSettings.values.syncedDevices;
        const newEndpoints = endpoints.map(endpoint => endpoint.endpointId);
        const deleted = new Set(existingEndpoints);

        for (const id of newEndpoints) {
            deleted.delete(id);
        }

        const all = new Set([...existingEndpoints, ...newEndpoints]);

        // save all the endpoints
        this.storageSettings.values.syncedDevices = [...all];

        // delete leftover endpoints
        await this.deleteEndpoints(...deleted);

        // prune if the delete report completed successfully
        this.storageSettings.values.syncedDevices = newEndpoints;
    }

    async deleteEndpoints(...ids: string[]) {
        if (!ids.length)
            return;

        const accessToken = await this.getAccessToken();
        return this.postEvent({
            "event": {
                "header": {
                    "namespace": "Alexa.Discovery",
                    "name": "DeleteReport",
                    "messageId": createMessageId(),
                    "payloadVersion": "3"
                },
                "payload": {
                    "endpoints": ids.map(id => ({
                        "endpointId": id,
                    })),
                    "scope": {
                        "type": "BearerToken",
                        "token": accessToken,
                    }
                }
            }
        })
    }

    private setReauthenticateAlert() {
        const msg: string = "Please reauthenticate by following the directions below.";
        this.log.a(msg);
    }

    getAccessToken(): Promise<string> {
        if (this.accessToken)
            return this.accessToken;

        this.log.clearAlerts();

        const { tokenInfo } = this.storageSettings.values;

        if (tokenInfo === undefined) {
            this.setReauthenticateAlert();
            throw new Error("'tokenInfo' is undefined");
        }

        const { code } = tokenInfo;

        const body: Record<string, string> = {
            client_id,
            client_secret
        };
        if (code) {
            body.code = code;
            body.grant_type = 'authorization_code';
        }
        else {
            const { refresh_token } = tokenInfo;
            body.refresh_token = refresh_token;
            body.grant_type = 'refresh_token';
        }

        const self = this;

        const accessTokenPromise = (async () => {
            const response = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams(body).toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            }).catch(error => {
                switch (error?.response?.data?.error) {
                    case 'invalid_client':
                    case 'invalid_grant':
                    case 'unauthorized_client':
                        self.console.error(error?.response?.data);
                        self.log.a(error?.response?.data?.error_description);
                        self.storageSettings.values.tokenInfo = undefined;
                        self.accessToken = undefined;
                        break;

                    case 'authorization_pending':
                        self.console.warn(error?.response?.data);
                        self.log.a(error?.response?.data?.error_description);
                        break;

                    case 'expired_token':
                        self.console.warn(error?.response?.data);
                        self.log.a(error?.response?.data?.error_description);
                        self.accessToken = undefined;
                        break;

                    default:
                        self.console.error(error?.response?.data);
                }
                throw error;
            });
            // expires_in is 1 hr
            const { access_token, expires_in } = response.data;
            this.storageSettings.values.tokenInfo = response.data;
            setTimeout(() => {
                if (this.accessToken === accessTokenPromise)
                    this.accessToken = undefined;
            }, (expires_in - 300) * 1000);
            return access_token;
        })();

        this.accessToken = accessTokenPromise;
        this.accessToken.catch(() => this.accessToken = undefined);
        return this.accessToken;
    }

    async onAlexaAuthorization(request: HttpRequest, response: AlexaHttpResponse, directive: any) {
        const { grant } = directive.payload;
        this.storageSettings.values.tokenInfo = grant;
        this.storageSettings.values.apiEndpoint = undefined;
        this.accessToken = undefined;

        const self = this;
        let accessToken: any;

        try {
            accessToken = await this.getAccessToken();
        }
        catch (reason) {
            self.console.error(`Failed to handle the AcceptGrant directive because ${reason}`);

            this.storageSettings.values.tokenInfo = undefined;
            this.storageSettings.values.apiEndpoint = undefined;
            this.accessToken = undefined;

            response.send(authErrorResponse("ACCEPT_GRANT_FAILED", `Failed to handle the AcceptGrant directive because ${reason}`, directive));

            return;
        };
        this.log.clearAlerts();
        response.send({
            "event": {
                "header": {
                    "namespace": "Alexa.Authorization",
                    "name": "AcceptGrant.Response",
                    "messageId": createMessageId(),
                    "payloadVersion": "3"
                },
                "payload": {}
            }
        });
    }

    async getEndpointForDevice(device: ScryptedDevice): Promise<DiscoveryEndpoint> {
        if (!device)
            return;

        const discovery = await supportedTypes.get(device.type)?.discover(device);
        if (!discovery)
            return;

        const data: DiscoveryEndpoint = {
            endpointId: device.id,
            manufacturerName: "Scrypted",
            description: `${device.info?.manufacturer ?? 'Unknown'} ${device.info?.model ?? `device of type ${device.type}`}, connected via Scrypted`,
            friendlyName: device.name,
            additionalAttributes: {
                manufacturer: device.info?.manufacturer || undefined,
                model: device.info?.model || undefined,
                serialNumber: device.info?.serialNumber || undefined,
                firmwareVersion: device.info?.firmware || undefined,
                softwareVersion: device.info?.version || undefined
            },
            displayCategories: discovery.displayCategories,
            capabilities: discovery.capabilities
        };

        let supportedEndpointHealths: any[] = [];

        if (device.interfaces.includes(ScryptedInterface.Online)) {
            supportedEndpointHealths.push({
                "name": "connectivity"
            });
        }

        // {
        //     "name": "radioDiagnostics"
        // },
        // {
        //     "name": "networkThroughput"
        // }

        if (device.interfaces.includes(ScryptedInterface.Battery)) {
            supportedEndpointHealths.push({
                "name": "battery"
            })
        }

        if (supportedEndpointHealths.length > 0) {
            data.capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.EndpointHealth",
                    "version": "3.2",
                    "properties": {
                        "supported": supportedEndpointHealths,
                        "proactivelyReported": true,
                        "retrievable": true
                    }
                }
            );
        }

        data.capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa",
                "version": "3"
            }
        );

        if (device.info?.mac !== undefined)
            data.connections = [
                {
                    "type": "TCP_IP",
                    "macAddress": device.info.mac
                }
            ];

        return data as any;
    }

    async onRequest(request: HttpRequest, rawResponse: HttpResponse) {
        const response = new HttpResponseLoggingImpl(rawResponse, this.console);

        const { authorization } = request.headers;
        if (!this.validAuths.has(authorization)) {
            try {
                debug("making authorization request to Scrypted");

                const getcookieResponse = await axios.get('https://home.scrypted.app/_punch/getcookie', {
                    headers: {
                        'Authorization': authorization,
                    }
                });
                // new tokens will contain a lot of information, including the expiry and client id.
                // validate this. old tokens will be grandfathered in.
                if (getcookieResponse.data.expiry && getcookieResponse.data.clientId !== 'amazon')
                    throw new Error('client id mismatch');
                if (!this.storageSettings.values.pairedUserId) {
                    this.storageSettings.values.pairedUserId = getcookieResponse.data.id;
                }
                else if (this.storageSettings.values.pairedUserId !== getcookieResponse.data.id) {
                    this.log.a('This plugin is already paired with a different account. Clear the existing key in the plugin settings to pair this plugin with a different account.');
                    throw new Error('user id mismatch');
                }
                this.validAuths.add(authorization);
            }
            catch (e) {
                this.console.error(`request failed due to invalid authorization`, e);
                response.send(e.message, {
                    code: 500,
                });
                return;
            }
        }

        const body = JSON.parse(request.body);
        const { directive } = body;
        const { namespace, name } = directive.header;

        const mapName = `${namespace}/${name}`;

        debug("received directive from alexa", mapName, body);

        const handler = alexaHandlers.get(mapName);
        if (handler) {
            await handler.apply(this, [request, response, directive]);
            return;
        }

        const deviceHandler = alexaDeviceHandlers.get(mapName);

        const getDevice = () => {
            const device = systemManager.getDeviceById(directive.endpoint.endpointId);
            if (!device || !device.mixins.includes(this.id)) {
                response.send(deviceErrorResponse("NO_SUCH_ENDPOINT", "The device doesn't exist in Scrypted or was removed from the Alexa Plugin", directive));
                this.deleteEndpoints(directive.endpoint.endpointId).catch(() => { });
                return;
            }
            return device;
        }

        if (deviceHandler) {
            const device = getDevice();
            if (!device)
                return;
            await deviceHandler.apply(this, [request, response, directive, device]);
            return;
        } else {
            this.console.error(`no handler for: ${mapName}`);
            if (!getDevice())
                return;
        }

        // it is better to send a non-specific response than an error, as the API might get rate throttled
        response.send(mirroredResponse(directive));
    }
}

enum DeviceMixinStatus {
    NotSupported = 0,
    Setup = 1,
    AlreadySetup = 2,
    Skip = 3,
}

class HttpResponseLoggingImpl implements AlexaHttpResponse {
    constructor(private response: HttpResponse, private console: Console) {
    }

    send(body: string): void;
    send(body: string, options: HttpResponseOptions): void;
    send(body: Buffer): void;
    send(body: Buffer, options: HttpResponseOptions): void;
    send(body: any, options?: any): void {
        if (!options)
            options = {};

        if (!options.code)
            options.code = 200;

        if (options.code !== 200)
            this.console.error(`response error ${options.code}:`, body);
        else
            debug("response to alexa directive", options.code, body);

        if (typeof body === 'object')
            body = JSON.stringify(body);

        this.response.send(body, options);
    }
    sendFile(path: string): void;
    sendFile(path: string, options: HttpResponseOptions): void;
    sendFile(path: any, options?: any): void {
        this.response.sendFile(path, options);
    }
    sendSocket(socket: any, options: HttpResponseOptions): void {
        this.response.sendSocket(socket, options);
    }
    sendStream(stream: AsyncGenerator<Buffer, void>, options?: HttpResponseOptions): void {
        this.response.sendStream(stream, options);
    }
}

export default AlexaPlugin;
