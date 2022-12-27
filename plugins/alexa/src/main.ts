import axios from 'axios';
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { isSupported } from './types';
import { DiscoveryEndpoint, DiscoverEvent } from 'alexa-smarthome-ts';
import { AlexaHandler, addBattery, addOnline, addPowerSensor, capabilityHandlers, supportedTypes } from './types/common';
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
    validAuths = new Set<string>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.handlers.set('Alexa.Authorization', this.alexaAuthorization);
        this.handlers.set('Alexa.Discovery', this.alexaDiscovery);

        this.syncDevices();

        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (!eventSource)
                return;

            if (!this.storageSettings.values.syncedDevices.includes(eventSource.id))
                return;

            const supportedType = supportedTypes.get(eventSource.type);
            if (!supportedType) {
                this.console.warn(`${eventSource.name} no longer supported type?`);
                return;
            }

            const report = await supportedType.sendEvent(eventSource, eventDetails, eventData);
            let data = {
                "event": {
                    "header": {
                        "messageId": createMessageId(),
                        "namespace": report?.namespace ?? "Alexa",
                        "name": report?.name ?? "ChangeReport",
                        "payloadVersion": "3"
                    },
                    "endpoint": {
                        "endpointId": eventSource.id,
                        "scope": undefined
                    },
                    "payload": report?.payload,
                },
                "context": report?.context
            }

            data = addOnline(data, eventSource);
            data = addBattery(data, eventSource);
            data = addPowerSensor(data, eventSource);

            // nothing to report
            if (data.context === undefined && data.event.payload === undefined)
               return;
           
            const accessToken = await this.getAccessToken();
            data.event.endpoint.scope = {
                "type": "BearerToken",
                "token": accessToken,
            };

            await this.postEvent(data);
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

    async postEvent(data: any) {
        const accessToken = await this.getAccessToken();
        const self = this;

        return axios.post('https://api.amazonalexa.com/v3/events', data, {
            headers: {
                'Authorization': 'Bearer ' + accessToken,
            }
        }).catch(error => {
            if (error?.response?.data?.payload?.code === 'SKILL_DISABLED_EXCEPTION') {
                self.storageSettings.values.tokenInfo = undefined;
                self.accessToken = undefined;
            }

            self.console.error(error?.response?.data);
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
        await this.postEvent({
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

        if (tokenInfo === undefined) {
            this.log.e("Please reauthenticate by following the directions below.");
            throw new Error("Please reauthenticate by following the directions below.");
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
                        self.storageSettings.values.tokenInfo = undefined;
                        self.log.e(error?.response?.data?.error_description);
                        break;

                    case 'authorization_pending':
                        self.log.w(error?.response?.data?.error_description);
                        break;
                    
                    case 'expired_token':
                        self.accessToken = undefined;
                        break;

                    default:
                        self.console.error(error?.response?.data);
                }
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

    async alexaAuthorization(request: HttpRequest, response: HttpResponse) {
        const json = JSON.parse(request.body);
        const { grant } = json.directive.payload;
        this.storageSettings.values.tokenInfo = grant;
        this.accessToken = undefined;
        
        let accessToken = await this.getAccessToken().catch(reason => {
            this.storageSettings.values.tokenInfo = undefined;
            this.accessToken = undefined;

            response.send(JSON.stringify({
                "event": {
                    "header": {
                        "namespace": "Alexa.Authorization",
                        "name": "ErrorResponse",
                        "messageId": createMessageId(),
                        "payloadVersion": "3"
                    },
                    "payload": {
                        "type": "ACCEPT_GRANT_FAILED",
                        "message": `Failed to handle the AcceptGrant directive because ${reason}`
                    }
                }
            }));
        });

        if (accessToken !== undefined) {
            try {
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
            } catch (error) {
                this.storageSettings.values.tokenInfo = undefined;
                this.accessToken = undefined;
                throw error;
            }
        }
    }

    createEndpoint(device: ScryptedDevice): DiscoveryEndpoint<any> {
        if (!device)
            return;
        const discovery = isSupported(device);
        if (!discovery)
            return;

        const ret = Object.assign({
            endpointId: device.id,
            manufacturerName: "Scrypted",
            description: `${device.info?.manufacturer ?? 'Unknown'} ${device.info?.model ?? `device of type ${device.type}`}, connected via Scrypted`,
            friendlyName: device.name,
            additionalAttributes: {
                manufacturer: device.info?.manufacturer || undefined,
                model: device.info?.model || undefined,
                serialNumber: device.info?.serialNumber || undefined,
                firmwareVersion: device.info?.firmware || undefined,
                //softwareVersion: device.info?.version || undefined
            }
        }, discovery);

        let supportedEndpointHealths = [{
            "name": "connectivity"
        }];
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

        ret.capabilities.push(
            {
                "type": "AlexaInterface",
                "interface": "Alexa.EndpointHealth",
                "version": "3.2" as any,
                "properties": {
                    "supported": supportedEndpointHealths,
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

        //if (device.info?.mac !== undefined)
        //    ret.connections.push(
        //        {
        //            "type": "TCP_IP",
        //            "macAddress": device.info?.mac || undefined
        //        }
        //    );

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
        const { authorization } = request.headers;
        if (!this.validAuths.has(authorization)) {
            try {
                await axios.get('https://home.scrypted.app/_punch/getcookie', {
                    headers: {
                        'Authorization': authorization,
                    }
                });
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
