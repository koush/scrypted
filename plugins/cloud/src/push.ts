import Debug from 'debug';
import { EventEmitter } from 'events';
const { register, listen } = require('push-receiver');

export declare interface PushManager {
    on(event: 'message', listener: (data: any) => void): this;
    on(event: 'registrationId', listener: (registrationId: string) => void): this;
}

export class PushManager extends EventEmitter {
    registrationId: Promise<string>;

    constructor(public senders: Record<string, string>) {
        super();
        this.senders = senders;

        this.registrationId = (async () => {
            const credentialsJson = localStorage.getItem('fcm');
            let credentials: any;
            try {
                if (!credentialsJson)
                    throw new Error();
                credentials = JSON.parse(credentialsJson);
            }
            catch (e) {
                credentials = await register(Object.keys(senders)[0]);
                localStorage.setItem('fcm', JSON.stringify(credentials));
            }

            let persistentIds = [];
            try {
                persistentIds = JSON.parse(localStorage.getItem('persistentIds'));
            }
            catch (e) {
            }

            const backoff = Date.now();
            let client = await listen({ ...credentials, persistentIds: [] }, (notification: any) => {
                try {
                    localStorage.setItem('persistentIds', JSON.stringify(client._persistentIds));
                    // check timestamp/type instead?
                    if (Date.now() < backoff + 5000)
                        return;
                    if (!this.emit('message', notification.notification.data)) {
                        throw new Error('unhandled message');
                    }
                }
                catch (e) {
                    console.error('error processing push message', e);
                }
                // console.log(notification)
            });

            const registrationId = credentials.fcm.token;
            console.log('registration', registrationId);
            this.emit('registrationId', registrationId);
            return registrationId;
        })();
    }
}
