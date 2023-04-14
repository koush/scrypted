import { ScryptedDevice, EventListenerOptions, ScryptedDeviceBase } from "@scrypted/sdk";
import { Listen } from "./listen";

export interface Schedule {
    clockType: "AM" | "PM" | "24HourClock" | "BeforeSunrise" | "BeforeSunset" | "AfterSunrise" | "AfterSunset";
    friday: boolean;
    hour: number;
    minute: number;
    monday: boolean
    saturday: boolean
    sunday: boolean
    thursday: boolean;
    tuesday: boolean
    wednesday: boolean
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

        const date = new Date();
        date.setHours(schedule.hour);
        date.setMinutes(schedule.minute);

        const ret: ScryptedDevice = {
            async setName() { },
            async setType() { },
            async setRoom() { },
            async setMixins() { },
            async probe() { return true },
            listen(event: EventListenerOptions, callback, source?: ScryptedDeviceBase) {
                function reschedule(): Date {
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

                const when = reschedule();
                if (!when) {
                    return {
                        removeListener() {
                        }
                    }
                }

                const delay = when.getTime() - Date.now();
                source.log.i(`event will fire in ${Math.round(delay / 60 / 1000)} minutes.`);

                let timeout = setTimeout(() => {
                    reschedule();

                    callback(ret, {
                        eventId: undefined,
                        eventInterface: 'Scheduler',
                        eventTime: Date.now(),
                    }, when)
                }, delay);

                return {
                    removeListener() {
                        clearTimeout(timeout);
                    }
                }
            }
        }

        ret.name = 'Scheduler';
        return ret;
    }
}