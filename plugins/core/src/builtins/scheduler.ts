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
        if (schedule.clockType === 'AM' || schedule.clockType === 'PM') {
            let hour = schedule.hour;
            if (schedule.clockType === 'AM') {
                if (hour === 12)
                    hour -= 12;
            }
            else {
                if (hour != 12)
                    hour += 12;
            }
            date.setHours(hour);
            date.setMinutes(schedule.minute, 0, 0);
        }
        else if (schedule.clockType === '24HourClock') {
            date.setHours(schedule.hour, schedule.minute, 0, 0);
        }
        else {
            throw new Error('sunrise/sunset clock not supported');
        }



        const ret: ScryptedDevice = {
            async setName() { },
            async setType() { },
            async setRoom() { },
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
        
                        source.log.i(`event will fire at ${future}`);
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

                let timeout = setTimeout(() => {
                    reschedule();

                    callback(ret, {
                        eventInterface: 'Scheduler',
                        changed: true,
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