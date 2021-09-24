import { EventEmitter, once } from 'events';
import { Destroyable } from '../../rtsp/src/rtsp';
import DigestClient from './digest-client';

const onvif = require('onvif');
const { Cam } = onvif;

export enum OnvifEvent {
    MotionStart,
    MotionStop,
    AudioStart,
    AudioStop,
}

function stripNamespaces(topic: string) {
    // example input :-   tns1:MediaControl/tnsavg:ConfigurationUpdateAudioEncCfg 
    // Split on '/'
    // For each part, remove any namespace
    // Recombine parts that were split with '/'
    let output = '';
    let parts = topic.split('/')
    for (let index = 0; index < parts.length; index++) {
        let stringNoNamespace = parts[index].split(':').pop() // split on :, then return the last item in the array
        if (output.length == 0) {
            output += stringNoNamespace
        } else {
            output += '/' + stringNoNamespace
        }
    }
    return output
}

export class OnvifCameraAPI {
    digestAuth: DigestClient;

    constructor(public cam: any, username: string, password: string) {
        this.digestAuth = new DigestClient(username, password);
    }

    listenEvents() {
        const ret = new EventEmitter();
        this.cam.on('event', (event: any) => {
            const eventTopic = stripNamespaces(event.topic._)

            if (event.message.message.data && event.message.message.data.simpleItem) {
                const dataValue = event.message.message.data.simpleItem.$.Value
                if (eventTopic.includes('MotionAlarm')) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.MotionStart)
                    else
                        ret.emit('event', OnvifEvent.MotionStop)
                } else if (eventTopic.includes('DetectedSound')) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.AudioStart)
                    else
                        ret.emit('event', OnvifEvent.AudioStop)
                }
            }
        });
        return ret;
    }

    async getStreamUrl(): Promise<string> {
        return new Promise((resolve, reject) => this.cam.getStreamUri({ protocol: 'RTSP' }, (err: Error, uri: string) => err ? reject(err) : resolve(uri)));
    }

    async jpegSnapshot(): Promise<Buffer> {
        const url: string = (await new Promise((resolve, reject) => this.cam.getSnapshotUri((err: Error, uri: string) => err ? reject(err) : resolve(uri))) as any).uri;

        const response = await this.digestAuth.fetch(url);
        const buffer = await response.arrayBuffer();

        return Buffer.from(buffer);
    }
}

export async function connectCameraAPI(hostname: string, username: string, password: string) {
    const cam = await new Promise((resolve, reject) => {
        const cam = new Cam({
            hostname,
            username,
            password,
        }, (err: Error) => err ? reject(err) : resolve(cam)
        )
    });

    return new OnvifCameraAPI(cam, username, password);
}