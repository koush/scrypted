import { HikvisionDoorbellEvent } from './doorbell-events';

/** How the plugin learns about calls: 'none' while SIP handles them. */
export type CallDetection = 'none' | 'poll' | 'push';

/** Values of /ISAPI/VideoIntercom/callStatus that drive call events. */
export type PolledCallStatus = 'idle' | 'ring' | 'onCall';

/** Where the user-installed Hikvision SDK and the sidecar script live. */
export interface PushSdkConfig
{
    libDir: string;
    scriptPath: string;
    port: number;
    diagnostics: boolean;
}

export interface CallStatusControllerOptions
{
    mode: 'poll' | 'push';
    emit (e: HikvisionDoorbellEvent): void;
    setPolling (on: boolean): void;
    callCapMs?: number;
}

const DEFAULT_CALL_CAP_MS = 5 * 60 * 1000;

/**
 * Turns call status from the 1 s callStatus poll and the SDK push into
 * TalkInvite / TalkOnCall / TalkHangup.
 *
 * Poll mode, and push mode while the SDK is not connected: the poll drives every
 * event, exactly as before. Push mode with the SDK connected: SDK alarm 17 starts
 * a call and 18 ends it; the poll runs only during a call, because answering is
 * not pushed and the plugin needs onCall to stop ringing.
 */
export class CallStatusController
{
    private lastPolled = 'idle';
    private sdkUp = false;
    private callActive = false;
    private pollSawCall = false;
    private polling?: boolean;
    private capTimer?: NodeJS.Timeout;
    private destroyed = false;

    constructor (private o: CallStatusControllerOptions)
    {
    }

    start(): void
    {
        this.setPolling (true);
    }

    onPollStatus (status: PolledCallStatus): void
    {
        if (this.destroyed || status === this.lastPolled) {
            return;
        }
        this.lastPolled = status;

        if (this.o.mode === 'poll' || !this.sdkUp) {
            if (status === 'ring') {
                this.callActive = true;
                this.pollSawCall = true;
                this.o.emit (HikvisionDoorbellEvent.TalkInvite);
            }
            else if (status === 'onCall') {
                this.callActive = true;
                this.pollSawCall = true;
                this.o.emit (HikvisionDoorbellEvent.TalkOnCall);
            }
            else if (status === 'idle') {
                this.endCall();
            }
            return;
        }

        // SDK connected: polls only refine a call the SDK started
        if (!this.callActive) {
            return;
        }
        if (status === 'ring') {
            this.pollSawCall = true;
        }
        else if (status === 'onCall') {
            this.pollSawCall = true;
            this.o.emit (HikvisionDoorbellEvent.TalkOnCall);
        }
        else if (status === 'idle' && this.pollSawCall) {
            // the station ended the call but alarm 18 never arrived
            this.endCall();
        }
    }

    onSdkReady(): void
    {
        if (this.destroyed) {
            return;
        }
        this.sdkUp = true;
        if (!this.callActive) {
            this.setPolling (false);
        }
    }

    onSdkDown(): void
    {
        if (this.destroyed) {
            return;
        }
        this.sdkUp = false;
        this.setPolling (true);
    }

    onSdkRing(): void
    {
        if (this.destroyed || this.o.mode !== 'push') {
            return;
        }
        if (!this.callActive) {
            // callStatus can still read idle for a moment after the alarm
            this.lastPolled = 'idle';
            this.pollSawCall = false;
        }
        this.callActive = true;
        this.o.emit (HikvisionDoorbellEvent.TalkInvite);
        this.setPolling (true);
        clearTimeout (this.capTimer);
        this.capTimer = setTimeout (() => this.endCall(), this.o.callCapMs ?? DEFAULT_CALL_CAP_MS);
    }

    onSdkEnd(): void
    {
        if (this.destroyed || this.o.mode !== 'push') {
            return;
        }
        this.endCall();
    }

    destroy(): void
    {
        this.destroyed = true;
        clearTimeout (this.capTimer);
        this.capTimer = undefined;
    }

    private endCall()
    {
        clearTimeout (this.capTimer);
        this.capTimer = undefined;
        if (!this.callActive) {
            return;
        }
        this.callActive = false;
        this.pollSawCall = false;
        this.lastPolled = 'idle';
        this.o.emit (HikvisionDoorbellEvent.TalkHangup);
        if (this.o.mode === 'push' && this.sdkUp) {
            this.setPolling (false);
        }
    }

    private setPolling (on: boolean)
    {
        if (this.polling === on) {
            return;
        }
        this.polling = on;
        this.o.setPolling (on);
    }
}
