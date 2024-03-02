import { HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, PushHandler, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, Setting, Settings, SettingValue, WritableDeviceState } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { randomBytes } from 'crypto';

const allInterfaceMethods: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
const allInterfaceProperties: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));

import { isPublishable} from '../../mqtt/src/publishable-types';

const { systemManager, endpointManager, mediaManager } = sdk;

const mediaObjectMethods = [
    'takePicture',
    'getVideoStream',
]

class WebhookMixin extends SettingsMixinDeviceBase<Settings> {
    async getMixinSettings(): Promise<Setting[]> {
        const realDevice = systemManager.getDeviceById(this.id);
        return [
            {
                title: 'Create Webhook',
                key: 'create',
                description: 'Create a Webhook for a device interface. E.g., OnOff to turn a light on or off, or Camera to retrieve an image. The created webhook will be viewable in the Console.',
                choices: realDevice.interfaces,
            }
        ]
    }

    async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);

        let token = this.storage.getItem('token');
        if (!token) {
            token = randomBytes(8).toString('hex');
            this.storage.setItem('token', token);
        }

        this.console.log();
        this.console.log();
        this.console.log("##################################################")
        const localEndpoint = await endpointManager.getPublicLocalEndpoint(this.mixinProviderNativeId);
        const insecureLocalEndpoint = await endpointManager.getInsecurePublicLocalEndpoint(this.mixinProviderNativeId);
        this.console.log('Local Base URL');
        this.console.log('.\t', localEndpoint + this.id + '/' + token);
        this.console.log();
        this.console.log('Insecure Local Base URL');
        this.console.log('.\t', insecureLocalEndpoint + this.id + '/' + token);
        this.console.log();

        // let cloudEndpoint: string;
        // try {
        //     cloudEndpoint = await endpointManager.getPublicCloudEndpoint(this.mixinProviderNativeId);
        // }
        // catch (e) {
        //     this.console.error('Unable to generate cloud endpoint. Is the @scrypted/cloud plugin installed?', e);
        //     this.console.warn('Only local network webhooks are available.');
        // }

        const iface = ScryptedInterfaceDescriptors[value.toString()];
        if (iface.properties?.length) {
            this.console.log();
            this.console.log('Webhook Get States:')
            for (const property of iface.properties) {
                this.console.log(`.\t/${property}`);
            }
        }
        if (iface.methods?.length) {
            this.console.log();
            this.console.log('Webhook Invoke Actions:')
            for (const method of iface.methods) {
                this.console.log(`.\t/${method}`);
            }
        }
        this.console.log('Webhook Actions can receive parameters via a JSON array query parameter "parameters".');
        this.console.log('For example:');
        this.console.log(".\tcurl 'http://<your-host-and-port>/endpoint/@scrypted/webhook/<id>/<token>/setBrightness?parameters=[30]'");
        this.console.log("##################################################")
    }

    async maybeSendMediaObject(response: HttpResponse, value: any, method: string) {
        if (!mediaObjectMethods.includes(method)) {
            response?.send(value?.toString());
            return;
        }

        const buffer = await mediaManager.convertMediaObjectToBuffer(value, 'image/jpeg');
        response?.send(buffer, {
            headers: {
                'Content-Type': 'image/jpeg',
            }
        });
    }

    async handle(request: HttpRequest, response: HttpResponse, device: ScryptedDevice, pathSegments: string[]) {
        const token = pathSegments[2];
        if (token !== this.storage.getItem('token')) {
            response?.send('Invalid Token', {
                code: 401,
            });
            return;
        }
        const methodOrProperty = pathSegments[3];
        if (allInterfaceMethods.includes(methodOrProperty)) {
            try {
                const query = new URLSearchParams(request.url.split('?')[1] || '');
                let parameters = [];
                const p = query.get('parameters');
                if (p) {
                    parameters = JSON.parse(p);
                }

                const result = await device[methodOrProperty](...parameters);
                if (request.headers['accept']?.includes('application/json')) {
                    response?.send(JSON.stringify({ result }), {
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });
                }
                else {
                    await this.maybeSendMediaObject(response, result, methodOrProperty);
                }
            }
            catch (e) {
                this.console.error('webhook action error', e);
                response.send('Internal Error', {
                    code: 500,
                });
            }
        }
        else if (allInterfaceProperties.includes(methodOrProperty)) {
            const value = device[methodOrProperty];
            if (request.headers['accept']?.includes('application/json')) {
                response?.send(JSON.stringify({ value }), {
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });
            }
            else {
                response?.send(value?.toString());
            }
        }
        else {
            this.console.error('Unknown method or property', methodOrProperty);
            response.send('Not Found', {
                code: 404,
            });
        }
    }
}

class WebhookPlugin extends ScryptedDeviceBase implements Settings, MixinProvider, HttpRequestHandler, PushHandler {
    createdMixins = new Map<string, WebhookMixin>();

    async handle(request: HttpRequest, response?: HttpResponse) {
        this.console.log('received webhook', request);

        const relPath = request.url.substring(request.rootPath.length).split('?')[0];
        const pathSegments = relPath.split('/');
        const id = pathSegments[1];

        const device = systemManager.getDeviceById<ScryptedDevice & Settings>(id);
        if (!device) {
            this.console.error('no such device');
            response.send('Not Found', {
                code: 404,
            })
            return;
        }
        this.console.log('device', id, device.name);

        if (!device.mixins.includes(this.id)) {
            this.console.error('device does not have webhooks enabled');
            response.send('Not Found', {
                code: 404,
            })
            return;
        }

        if (!this.createdMixins.has(id)) {
            await device.getSettings();
        }
        const mixin = this.createdMixins.get(id);
        if (!mixin) {
            response.send('Not Found', {
                code: 404,
            });
            return;
        }
        await mixin.handle(request, response, device, pathSegments);
    }

    onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        return this.handle(request, response);
    }

    onPush(request: HttpRequest): Promise<void> {
        return this.handle(request);
    }

    async getSettings(): Promise<Setting[]> {
        return [

        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!isPublishable(type, interfaces))
            return;
        return [
            ScryptedInterface.Settings,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        const ret = new WebhookMixin({
            mixinDevice,
            mixinDeviceState,
            mixinDeviceInterfaces,
            mixinProviderNativeId: this.nativeId,
            group: "Webhook",
            groupKey: "webhook",
        });

        this.createdMixins.set(ret.id, ret);
        return ret;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        if (this.createdMixins.get(id) === mixinDevice) {
            this.createdMixins.delete(id);
        }
    }
}

export default new WebhookPlugin();
