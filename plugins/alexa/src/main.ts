import axios from 'axios';
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/common/src/settings';
import crypto from 'crypto';
import { isSupported } from './types';
import { DiscoveryEndpoint, DiscoverEvent } from 'alexa-smarthome-ts';
import { AlexaHandler, capabilityHandlers } from './types/common';

const { systemManager } = sdk;

const client_id = "amzn1.application-oa2-client.3283807e04d8408eb44a698c10f9dd13";
const client_secret = "bed445e2b26730acd818b90e175b275f6b67b18ff8645e571c5b3e311fa75ee9";

class AlexaPlugin extends ScryptedDeviceBase implements HttpRequestHandler {
    storageSettings = new StorageSettings(this, {
        tokenInfo: {
            hide: true,
            json: true,
        }
    })
    handlers = new Map<string, AlexaHandler>();
    accessToken: Promise<string>;

    constructor(nativeId?: string) {
        super(nativeId);

        this.handlers.set('Alexa.Authorization', this.alexaAuthorization);
        this.handlers.set('Alexa.Discovery', this.alexaDiscovery);
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
                    "messageId": crypto.randomBytes(8).toString('hex'),
                    "payloadVersion": "3"
                },
                "payload": {}
            }
        }));
    }

    async alexaDiscovery(request: HttpRequest, response: HttpResponse) {
        const endpoints: DiscoveryEndpoint<any>[] = [];

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            let discovery = isSupported(device);
            if (!discovery)
                continue;

            discovery = Object.assign({
                endpointId: device.id,
                manufacturerName: device.info?.manufacturer || 'Scrypted Camera',
                description: device.type,
                friendlyName: device.name,
            }, discovery);

            discovery.capabilities.push(
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

            endpoints.push(discovery as any);
        }

        const ret: DiscoverEvent<any> = {
            event: {
                header: {
                    namespace: 'Alexa.Discovery',
                    name: 'Discover.Response',
                    messageId: crypto.randomBytes(8).toString('hex'),
                    payloadVersion: '3',
                },
                payload: {
                    endpoints,
                }
            }
        }

        response.send(JSON.stringify(ret));
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
