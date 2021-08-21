import { EventEmitter } from 'events';
import { ScryptedRuntime } from './runtime';
import crypto from 'crypto';
import { ScryptedAlert } from './db-types';

export function makeAlertId(path: string, msg: string): string {
    return crypto.createHash('sha256').update(path).update(msg).digest('base64');
}

export interface LogEntry {
    title: string;
    timestamp: number;
    level: string,
    message: string;
    path: string;
}

export class Logger extends EventEmitter {
    logs: LogEntry[] = [];
    children: { [id: string]: Logger } = {};
    path: string;
    title: string;
    scrypted: ScryptedRuntime;

    constructor(scrypted: ScryptedRuntime, path: string, title: string) {
        super();
        this.scrypted = scrypted;
        this.path = path;
        this.title = title;
    }

    log(level: string, message: string) {
        const timestamp = Date.now();
        const entry = {
            timestamp,
            level,
            message,
            path: this.path,
            title: this.title,
        };
        this.logs.push(entry);

        console.log(level, this.title, message);
        this.emit('log', entry);
    }

    purge(before: number) {
        this.logs = this.logs.filter(log => log.timestamp < before);
        for (const child of Object.values(this.children)) {
            child.purge(before);
        }
    }

    async clear() {
        await this.clearAlerts();

        this.logs = [];
        for (const child of Object.values(this.children)) {
            await child.clear();
        }
    }

    async clearAlert(message: string) {
        const id = makeAlertId(this.path, message);
        await this.scrypted.datastore.removeId(ScryptedAlert, id);
    }

    async clearAlerts() {
        for await (const alert of this.scrypted.datastore.getAll(ScryptedAlert)) {
            if (alert.path.startsWith(this.path)) {
                await this.scrypted.datastore.remove(alert);
            }
        }
    }

    getLogger(id: string, title: string): Logger {
        if (this.children[id])
            return this.children[id];

        const ret = new Logger(this.scrypted, `${this.path}/${id}`, title);
        ret.on('log', entry => this.emit('log', entry));
        this.children[id] = ret;
        return ret;
    }

    getLogs(): LogEntry[] {
        const allLogs = Object.values(this.children).map(child => child.getLogs()).flat().concat(this.logs);
        allLogs.sort((a, b) => a.timestamp - b.timestamp);
        return allLogs;
    }
}
