import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { parseSidecarLine, SidecarMessage } from './sidecar-protocol';

export interface SdkCallSourceOptions
{
    libDir: string;
    scriptPath: string;
    host: string;
    port: number;
    username: string;
    password: string;
    diagnostics: boolean;
    console: Console;
    pythonPath?: string;
    spawnFn?: typeof spawn;
    restartDelaysMs?: number[];
}

const DEFAULT_RESTART_DELAYS_MS = [5000, 10000, 20000, 40000, 60000];
const STOP_GRACE_MS = 3000;

// HCNetSDK.h NET_DVR_PASSWORD_ERROR / NET_DVR_USER_LOCKED: retrying only adds failed logins
// and can lock the server's address out of the doorbell, polling included
const AUTH_ERRORS: Record<number, string> = {
    1: 'wrong user name or password',
    153: 'user locked on the doorbell',
};

/**
 * Runs the HCNetSDK sidecar for one door station and turns its output into events:
 * 'ready'(sdkVersion), 'ring', 'end', 'down'(reason) and 'message'(SidecarMessage)
 * for every parsed line. Restarts the sidecar with backoff until stop() is called.
 */
export class SdkCallSource extends EventEmitter
{
    private child?: ChildProcess;
    private running = false;
    private up = false;
    private attempt = 0;
    private sdkVersion = '';
    private lastError = '';
    private authError?: string;
    private restartTimer?: NodeJS.Timeout;

    constructor (private o: SdkCallSourceOptions)
    {
        super();
    }

    start(): void
    {
        if (this.running) {
            return;
        }
        this.running = true;
        this.spawnChild();
    }

    stop(): void
    {
        this.running = false;
        this.up = false;
        clearTimeout (this.restartTimer);
        this.restartTimer = undefined;
        const child = this.child;
        this.child = undefined;
        if (!child) {
            return;
        }
        // stdin EOF lets the sidecar log out of the station; SIGTERM only if it hangs
        child.stdin?.end();
        const killTimer = setTimeout (() => child.kill ('SIGTERM'), STOP_GRACE_MS);
        child.once ('exit', () => clearTimeout (killTimer));
    }

    private spawnChild()
    {
        const { libDir, scriptPath, host, port, username, password, diagnostics } = this.o;
        const spawnFn = this.o.spawnFn ?? spawn;
        this.lastError = '';
        this.authError = undefined;
        this.o.console.info ('Starting HCNetSDK sidecar');
        const child = spawnFn (this.o.pythonPath ?? 'python3', [scriptPath, libDir], {
            cwd: libDir,
            env: { ...process.env, LD_LIBRARY_PATH: libDir },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.child = child;

        child.on ('error', (error) => {
            this.lastError = error.message;
            this.onExit (child, null, null);
        });
        child.on ('exit', (code, signal) => this.onExit (child, code, signal));
        child.stdin.on ('error', () => {});
        createInterface ({ input: child.stdout }).on ('line', (line) => this.onLine (child, line));
        createInterface ({ input: child.stderr }).on ('line', (line) => this.o.console.debug (`HCNetSDK: ${line}`));

        child.stdin.write (JSON.stringify ({ host, port, username, password, diagnostics }) + '\n');
    }

    private onLine (child: ChildProcess, line: string)
    {
        if (child !== this.child) {
            return;
        }
        const message = parseSidecarLine (line);
        if (!message) {
            this.o.console.debug (`HCNetSDK sidecar: ${line}`);
            return;
        }
        this.emit ('message', message);
        this.handle (message);
    }

    private handle (message: SidecarMessage)
    {
        switch (message.type) {
            case 'ready':
                this.sdkVersion = message.sdkVersion;
                this.markUp();
                break;
            case 'reconnected':
                this.markUp();
                break;
            case 'ring':
                this.emit ('ring');
                break;
            case 'end':
                this.emit ('end');
                break;
            case 'disconnected':
                if (this.up) {
                    this.up = false;
                    this.emit ('down', 'station connection lost');
                }
                break;
            case 'error':
                this.authError = message.stage === 'login' ? AUTH_ERRORS[message.code] : undefined;
                this.lastError = this.authError
                    ? `login failed: ${this.authError} (SDK error ${message.code}), not retrying until settings are saved`
                    : `${message.stage} failed: ${message.message} (SDK error ${message.code})`;
                this.o.console.error (`HCNetSDK sidecar ${this.lastError}`);
                break;
        }
    }

    private markUp()
    {
        this.attempt = 0;
        this.up = true;
        this.emit ('ready', this.sdkVersion);
    }

    private onExit (child: ChildProcess, code: number | null, signal: string | null)
    {
        if (child !== this.child) {
            return;
        }
        this.child = undefined;
        this.up = false;
        if (!this.running) {
            return;
        }
        const reason = this.lastError || `sidecar exited (${signal ?? `code ${code}`})`;
        this.emit ('down', reason);
        if (this.authError) {
            return;
        }

        const delays = this.o.restartDelaysMs ?? DEFAULT_RESTART_DELAYS_MS;
        const delay = delays[Math.min (this.attempt, delays.length - 1)];
        this.attempt++;
        this.o.console.warn (`HCNetSDK sidecar down (${reason}), restarting in ${delay / 1000} s`);
        this.restartTimer = setTimeout (() => {
            this.restartTimer = undefined;
            if (this.running) {
                this.spawnChild();
            }
        }, delay);
    }
}
