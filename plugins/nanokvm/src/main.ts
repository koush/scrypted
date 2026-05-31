import fs from 'fs';
import crypto from 'crypto';
import sdk, { Camera, DeviceCreator, DeviceCreatorSettings, DeviceProvider, KvmKeyEvent, KvmMouseEvent, MediaObject, OnOff, RequestPictureOptions, ResponsePictureOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, StreamService } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { WebSocket } from 'ws';
import { Deferred } from '@scrypted/common/src/deferred';
import { createAsyncQueue } from '@scrypted/common/src/async-queue';
import { once } from 'events';
import { VirtualKeyboard } from './nanokvm/virtual-keyboard';
import { encrypt } from './nanokvm/encrypt';

class NanoKVMSessionControl implements RTCSessionControl {
    constructor(public h264: WebSocket) {

    }

    async getRefreshAt(): Promise<void> {
    }

    async extendSession(): Promise<void> {
    }

    async endSession(): Promise<void> {
        this.h264.close();
    }
    async setPlayback(options: { audio: boolean; video: boolean; }): Promise<void> {
    }
}

class NanoKVMDevice extends ScryptedDeviceBase implements Settings, RTCSignalingChannel, StreamService<(KvmKeyEvent | KvmMouseEvent)[], void>, Camera {
    cookie: Promise<string> | undefined;
    storageSettings = new StorageSettings(this, {
        host: {
            title: 'Host',
            type: 'string',
            placeholder: '192.168.2.222',
            onPut: () => {
                this.info = {
                    ...this.info,
                    ip: this.storageSettings.values.host,
                };
            }
        },
        username: {
            title: 'Username',
            type: 'string',
            defaultValue: 'admin',
        },
        password: {
            title: 'Password',
            type: 'password',
        },
    });

    constructor(nativeId: string) {
        super(nativeId);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue) {
        await this.storageSettings.putSetting(key, value);
    }

    async* dummyConnectStream(): AsyncGenerator<void, void, any> {

    }

    async getCookie() {
        if (this.cookie)
            return this.cookie;

        this.cookie = (async () => {
            const { host, password } = this.storageSettings.values;
            if (!host || !password)
                throw new Error('host and password are required');

            const url = new URL(`http://${host}/api/auth/login`);
            // {"username":"admin","password":"encrypted-password"}

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: this.storageSettings.values.username || 'admin',
                    password: encrypt(password),
                }),
            });

            const body = await response.json();
            const token = body.data.token;
            return token;
        })()
            .catch(e => {
                this.cookie = undefined;
                throw e;
            });

        return this.cookie;
    }

    async connectStream(input?: AsyncGenerator<(KvmKeyEvent | KvmMouseEvent)[], void, any> | undefined, options?: any): Promise<AsyncGenerator<void, void, any>> {
        const { host } = this.storageSettings.values;
        const wsUrl = new URL(`ws://${host}/api/ws`);
        const ws = new WebSocket(wsUrl, {
            headers: {
                cookie: `nano-kvm-token=${await this.getCookie()}`,
            },
        });
        await once(ws, 'open');
        const heartbeatTimer = setInterval(() => {
            ws.send(JSON.stringify({ event: 'heartbeat', data: '' }));
        }, 60 * 1000);
        ws.on('close', () => clearInterval(heartbeatTimer));

        const virtualKeyboard = new VirtualKeyboard(this.console, ws);

        (async () => {
            for await (const events of input!) {
                for (const event of events) {
                    if (event.event === 'mousedown') {
                        let button: number | undefined;
                        if (event.button === 0)
                            button = 1;
                        else if (event.button === 2)
                            button = 2;
                        if (button) {
                            ws.send(JSON.stringify([2, 1, button, 0, 0]));
                        }
                    }
                    else if (event.event === 'mouseup') {
                        ws.send(JSON.stringify([2, 1, 0, 0, 0]));
                    }
                    else if (event.event === 'mousemove') {
                        // 0-1 is scaled to 0-2^15
                        const x = Math.round(event.x * 32767);
                        const y = Math.round(event.y * 32767);
                        ws.send(JSON.stringify([2, 2, 0, x, y]));
                    }
                    else if (event.event === 'keyup') {
                        virtualKeyboard.onKeyReleased(event.code);
                    }
                    else if (event.event === 'keydown') {
                        virtualKeyboard.onKeyPress(event.code);
                    }
                }
            }
        })()
            .catch(e => {
                this.console.error('error in input stream', e);
            })
            .finally(() => {
                this.console.log('websocket closed');
                ws.close();
            })
        return this.dummyConnectStream();
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        const options: RTCSignalingOptions = {
            requiresOffer: true,
        };

        const { host } = this.storageSettings.values;

        const h264Url = new URL(`ws://${host}/api/stream/h264`);
        const h264 = new WebSocket(h264Url, {
            headers: {
                cookie: `nano-kvm-token=${await this.getCookie()}`,
            },
        });
        const answerSdp = new Deferred<RTCSessionDescriptionInit>();
        const candidateQueue = createAsyncQueue<RTCIceCandidateInit>();
        h264.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.event === 'answer') {
                // unsubscribe
                const answer = JSON.parse(message.data) as RTCSessionDescriptionInit;
                answerSdp.resolve(answer);
            }
            else if (message.event === 'candidate') {
                const candidate = JSON.parse(message.data) as RTCIceCandidateInit;
                candidateQueue.enqueue(candidate);
            }
        });
        await once(h264, 'open');
        h264.on('error', (e) => {
            this.console.error('websocket error', e);
            answerSdp.reject(e);
        });
        h264.on('close', () => {
            this.console.log('websocket closed');
            answerSdp.reject(new Error('websocket closed'));
        });

        await connectRTCSignalingClients(this.console, session,
            {
                type: 'offer',
                audio: {
                    direction: 'recvonly',
                },
                video: {
                    direction: 'recvonly',
                },
            },
            {
                __proxy_props: {
                    options,
                },
                options,
                createLocalDescription: async (type: 'offer' | 'answer', setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate) => {
                    if (type !== 'answer')
                        throw new Error('NanoKVM endpoint only supports RTC answer');

                    const answer = await answerSdp.promise;

                    if (sendIceCandidate) {
                        process.nextTick(() => candidateQueue.pipe(sendIceCandidate));
                    }
                    else {
                        // wait for all? doesnt seem to send a null event.
                    }

                    return {
                        type: 'answer',
                        sdp: answer.sdp,
                    };
                },
                setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                    if (description.type !== 'offer')
                        throw new Error('NanoKVM endpoint only supports RTC answer');

                    const message = {
                        event: 'offer',
                        data: JSON.stringify(description),
                    }
                    h264.send(JSON.stringify(message));
                },
                addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                    const message = {
                        event: 'candidate',
                        data: JSON.stringify(candidate),
                    };
                    h264.send(JSON.stringify(message));
                },
                getOptions: async () => options,
            }, {});

        return new NanoKVMSessionControl(h264);
    }

    async getPictureOptions(): Promise<ResponsePictureOptions[]> {
        return [];
    }

    async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const black = fs.promises.readFile('black.png');
        const mo = await sdk.mediaManager.createMediaObject(black, 'image/png');
        return mo;
    }
}

class NanoKVMPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    constructor(nativeId?: string) {
        super(nativeId);
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        const settings = [
            {
                key: 'name',
                title: 'Name',
                placeholder: 'NanoKVM',
            },
            {
                title: 'Host',
                key: 'host',
                placeholder: '192.168.2.222',
            },
            {
                title: 'Username',
                key: 'username',
                placeholder: 'admin',
                value: 'admin',
            },
            {
                title: 'Password',
                key: 'password',
                type: 'password',
            },
        ] satisfies Setting[];
        return settings;
    }

    async getDevice(nativeId: string): Promise<ScryptedDeviceBase> {
        return new NanoKVMDevice(nativeId);
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = crypto.randomBytes(8).toString('hex');
        const id = await sdk.deviceManager.onDeviceDiscovered({
            nativeId,
            name: settings.name as string || 'NanoKVM',
            interfaces: [
                ScryptedInterface.Settings,
                ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.Camera,
                ScryptedInterface.StreamService,
            ],
            type: ScryptedDeviceType.RemoteDesktop,
            info: {
                manufacturer: 'SiPEED',
                model: 'NanoKVM',
                ip: settings.host as string,
            }
        });

        const device = await this.getDevice(nativeId) as NanoKVMDevice;
        device.storageSettings.values.host = settings.host as string;
        device.storageSettings.values.username = settings.username as string || 'admin';
        device.storageSettings.values.password = settings.password as string;
        return id;
    }

    async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {

    }
}

export default NanoKVMPlugin;
