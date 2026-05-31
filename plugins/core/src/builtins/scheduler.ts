import { ScryptedDevice, EventListenerOptions, ScryptedDeviceBase } from "@scrypted/sdk";
import { Listen } from "./listen";

export interface Schedule {
    hour: number;
    minute: number;
    sunday: boolean
    monday: boolean
    tuesday: boolean
    wednesday: boolean
    thursday: boolean;
    friday: boolean;
    saturday: boolean
}

export class Scheduler {
    schedule(schedule: Schedule): Listen {
        const days = [
            schedule.sunday,
            schedule.monday,
            schedule.tuesday,
            schedule.wednesday,
            schedule.thursday,
            schedule.friday,
            schedule.saturday,
        ];

        const ret: ScryptedDevice = {
            async setName() { },
            async setType() { },
            async setRoom() { },
            async setMixins() { },
            async probe() { return true; },
            listen(event: EventListenerOptions, callback, source?: ScryptedDeviceBase) {
                function reschedule(): Date {
                    const date = new Date();
                    date.setHours(schedule.hour);
                    date.setMinutes(schedule.minute);

                    const now = Date.now();
                    for (let i = 0; i < 8; i++) {
                        const future = new Date(date.getTime() + i * 24 * 60 * 60 * 1000);
                        // don't reschedule for anything within 10 seconds.
                        if (future.getTime() <= now + 10000)
                            continue;
                        const day = future.getDay();
                        if (!days[day])
                            continue;

                        source.log.i(`event will fire at ${future.toLocaleString()}`);
                        return future;
                    }
                    source.log.w('event will never fire');
                }

                let timeout: NodeJS.Timeout = null;
                let when: Date = null;

                function timerCb() {
                    timeout = null;
                    const prevWhen = when;
                    setupTimer();
                    callback(ret, {
                        eventId: undefined,
                        eventInterface: 'Scheduler',
                        eventTime: Date.now(),
                    }, prevWhen);
                }

                function setupTimer() {
                    when = reschedule();
                    if (when) {
                        const delay = when.getTime() - Date.now();
                        source.log.i(`event will fire in ${Math.round(delay / 60 / 1000)} minutes.`);
                        timeout = setTimeout(timerCb, delay);
                    }
                }

                setupTimer();

                return {
                    removeListener() {
                        if (timeout) {
                            clearTimeout(timeout);
                        }
                        timeout = null;
                        when = null;
                    }
                };
            },
            id: "",
            pluginId: "",
            interfaces: [],
            mixins: [],
            providedInterfaces: []
        }

        ret.name = 'Scheduler';
        return ret;
    }
}