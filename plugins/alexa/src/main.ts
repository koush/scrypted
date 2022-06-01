import axios from 'axios';
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/common/src/settings';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { isSupported } from './types';
import { DiscoveryEndpoint, DiscoverEvent } from 'alexa-smarthome-ts';
import { AlexaHandler, capabilityHandlers, supportedTypes } from './types/common';
import { createMessageId } from './message';

const { systemManager, deviceManager } = sdk;

const client_id = "amzn1.application-oa2-client.3283807e04d8408eb44a698c10f9dd13";
const client_secret = "bed445e2b26730acd818b90e175b275f6b67b18ff8645e571c5b3e311fa75ee9";

class AlexaPlugin extends AutoenableMixinProvider implements HttpRequestHandler, MixinProvider {
    storageSettings = new StorageSettings(this, {
        tokenInfo: {
            hide: true,
            json: true,
        },
        syncedDevices: {
            multiple: true,
            hide: true,
        },
    });

    handlers = new Map<string, AlexaHandler>();
    accessToken: Promise<string>;

    constructor(nativeId?: string) {
        super(nativeId);

        this.handlers.set('Alexa.Authorization', this.alexaAuthorization);
        this.handlers.set('Alexa.Discovery', this.alexaDiscovery);

        this.syncDevices();

        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (!this.storageSettings.values.syncedDevices.includes(eventSource.id))
                return;

            const supportedType = supportedTypes.get(eventSource.type);
            if (!supportedType) {
                this.console.warn(`${eventSource.name} no longer supported type?`);
                return;
            }

            const report = await supportedType.reportState(eventSource, eventDetails, eventData);

            if (report?.type === 'event') {
                const accessToken = await this.getAccessToken();
                const data = {
                    "context": {},
                    "event": {
                        "header": {
                            "messageId": createMessageId(),
                            "namespace": report.namespace,
                            "name": report.name,
                            "payloadVersion": "3"
                        },
                        "endpoint": {
                            "scope": {
                                "type": "BearerToken",
                                "token": accessToken,
                            },
                            "endpointId": eventSource.id,
                        },
                        payload: report.payload,
                    }
                }

                await this.postEvent(accessToken, data);
            }
        });
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return mixinDevice;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        const device = systemManager.getDeviceById(id);
        if (device.mixins?.includes(this.id)) {
            return;
        }
        this.console.log('release mixin', id);
        this.log.a(`${device.name} was removed. The Alexa plugin will reload momentarily.`);
        deviceManager.requestRestart();
    }

    async postEvent(accessToken: string, data: any) {
        return axios.post('https://api.amazonalexa.com/v3/events', data, {
            headers: {
                'Authorization': 'Bearer ' + accessToken,
            }
        });
    }

    async syncDevices() {
        const endpoints = await this.addOrUpdateReport();
        await this.saveEndpoints(endpoints);
    }

    async addOrUpdateReport() {
        const endpoints = this.getDiscoveryEndpoints();

        if (!endpoints.length)
            return [];

        const accessToken = await this.getAccessToken();
        await this.postEvent(accessToken, {
            "event": {
                "header": {
                    "namespace": "Alexa.Discovery",
                    "name": "AddOrUpdateReport",
                    "payloadVersion": "3",
                    "messageId": createMessageId(),
                },
                "payload": {
                    endpoints,
                    "scope": {
                        "type": "BearerToken",
                        "token": accessToken,
                    }
                }
            }
        });

        return endpoints;
    }

    async deleteReport(...ids: string[]) {
        if (!ids.length)
            return;
        const accessToken = await this.getAccessToken();
        return this.postEvent(accessToken, {
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

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        const discovery = isSupported({
            type,
            interfaces,
        } as any);

        if (!discovery)
            return;
        return [];
    }

    getAccessToken(): Promise<string> {
        if (this.accessToken)
            return this.accessToken;

        const { tokenInfo } = this.storageSettings.values;
        const { code } = tokenInfo;

        const body: Record<string, string> = {
            client_id,
            client_secret,
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

        const accessTokenPromise = (async () => {
            const response = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams(body).toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            });
            const { access_token, expires_in } = response.data;
            this.storageSettings.values.tokenInfo = response.data;
            setTimeout(() => {
                if (this.accessToken === accessTokenPromise)
                    this.accessToken = undefined;
            }, expires_in * 1000 - 30000);
            return access_token;
        })();

        this.accessToken = accessTokenPromise;
        this.accessToken.catch(() => this.accessToken = undefined);
        return this.accessToken;
    }

    async alexaAuthorization(request: HttpRequest, response: HttpResponse) {
        const json = JSON.parse(request.body);
        const { grant } = json.directive.payload;
        this.storageSettings.values.tokenInfo = grant;
        this.getAccessToken();

        response.send(JSON.stringify({
            "event": {
                "header": {
                    "namespace": "Alexa.Authorization",
                    "name": "AcceptGrant.Response",
                    "messageId": createMessageId(),
                    "payloadVersion": "3"
                },
                "payload": {}
            }
        }));
    }

    createEndpoint(device: ScryptedDevice): DiscoveryEndpoint<any> {
        if (!device)
            return;
        const discovery = isSupported(device);
        if (!discovery)
            return;

        const ret = Object.assign({
            endpointId: device.id,
            manufacturerName: device.info?.manufacturer || 'Scrypted Camera',
            description: device.type,
            friendlyName: device.name,
        }, discovery);

        ret.capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa.EndpointHealth",
                "version": "3.2" as any,
                "properties": {
                    "supported": [
                        {
                            "name": "connectivity"
                        },
                        // {
                        //     "name": "battery"
                        // },
                        // {
                        //     "name": "radioDiagnostics"
                        // },
                        // {
                        //     "name": "networkThroughput"
                        // }
                    ],
                    "proactivelyReported": true,
                    "retrievable": true
                }
            },
            {
                "type": "AlexaInterface",
                "interface": "Alexa",
                "version": "3"
            }
        );

        return ret as any;
    }

    async saveEndpoints(endpoints: DiscoveryEndpoint<any>[]) {
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
        await this.deleteReport(...deleted);

        // prune if the delete report completed successfully
        this.storageSettings.values.syncedDevices = newEndpoints;
    }

    getDiscoveryEndpoints() {
        const endpoints: DiscoveryEndpoint<any>[] = [];

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);

            if (!device.mixins?.includes(this.id))
                continue;
            const endpoint = this.createEndpoint(device);
            if (endpoint)
                endpoints.push(endpoint);
        }
        return endpoints;
    }

    async alexaDiscovery(request: HttpRequest, response: HttpResponse) {
        const endpoints = this.getDiscoveryEndpoints();

        const ret: DiscoverEvent<any> = {
            event: {
                header: {
                    namespace: 'Alexa.Discovery',
                    name: 'Discover.Response',
                    messageId: createMessageId(),
                    payloadVersion: '3',
                },
                payload: {
                    endpoints,
                }
            }
        }

        response.send(JSON.stringify(ret));

        this.saveEndpoints(endpoints);
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        try {
            const body = JSON.parse(request.body);
            const { directive } = body;
            const { namespace } = directive.header;
            const handler = this.handlers.get(namespace);
            if (handler)
                return handler.apply(this, arguments);

            const capHandler = capabilityHandlers.get(namespace);
            if (capHandler) {
                const device = systemManager.getDeviceById(directive.endpoint.endpointId);
                if (!device) {
                    response.send('Not Found', {
                        code: 404,
                    });
                    return;
                }

                return capHandler.apply(this, [request, response, directive, device]);
            }

            response.send('Not Found', {
                code: 404,
            });
        }
        catch (e) {
            response.send(e.message, {
                code: 500,
            });
        }
    }
}

export default AlexaPlugin;
