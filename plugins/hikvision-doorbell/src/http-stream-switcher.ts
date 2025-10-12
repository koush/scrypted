import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

/**
 * HTTP Stream Switcher
 * Receives data from single source and writes to single active PassThrough stream
 * Supports seamless stream switching without stopping the data source
 */
export interface HttpSession {
    sessionId: string;
    stream: PassThrough;
    putPromise: Promise<any>;
}

export class HttpStreamSwitcher extends EventEmitter
{
    private currentStream?: PassThrough;
    private currentSession?: HttpSession;
    private byteCount: number = 0;
    private streamSwitchCount: number = 0;

    constructor (private console: Console) {
        super();
    }

    /**
     * Write data to current active stream
     */
    write (data: Buffer): void
    {
        if (!this.currentStream) {
            // No active stream, drop data
            return;
        }

        try {
            const canWrite = this.currentStream.write (data);
            this.byteCount += data.length;
            
            if (!canWrite) {
                // Stream buffer is full, apply backpressure
                this.console.warn ('Stream buffer full, applying backpressure');
            }
        } catch (error) {
            this.console.error ('Error writing to stream:', error);
            this.clearSession();
        }
    }

    /**
     * Switch to new HTTP session
     * Old session will be ended gracefully
     */
    switchSession (session: HttpSession): void
    {
        const oldSession = this.currentSession;
        
        if (oldSession) {
            this.console.debug (`Switching HTTP session ${oldSession.sessionId} -> ${session.sessionId} (${this.byteCount} bytes sent)`);
            
            // End old stream gracefully
            try {
                oldSession.stream.end();
            } catch (e) {
                // Ignore errors on old stream
            }
            
            this.streamSwitchCount++;
        } else {
            this.console.debug (`Setting initial HTTP session ${session.sessionId}`);
        }

        this.currentSession = session;
        this.currentStream = session.stream;
        this.byteCount = 0;

        // Setup error handler for new stream
        session.stream.on ('error', (error) => {
            this.console.error (`Stream error for session ${session.sessionId}:`, error);
            if (this.currentSession === session) {
                this.clearSession();
            }
        });

        session.stream.on ('close', () => {
            this.console.debug (`Stream closed for session ${session.sessionId}`);
            if (this.currentSession === session) {
                this.clearSession();
            }
        });
    }

    /**
     * Clear current session without replacement
     */
    private clearSession(): void
    {
        this.currentStream = undefined;
        this.currentSession = undefined;
    }

    /**
     * Get current session ID
     */
    getCurrentSessionId(): string | undefined
    {
        return this.currentSession?.sessionId;
    }

    /**
     * Check if given putPromise is current
     */
    isCurrentPutPromise (putPromise: Promise<any>): boolean
    {
        return this.currentSession?.putPromise === putPromise;
    }

    /**
     * Get current session
     */
    getCurrentSession(): HttpSession | undefined
    {
        return this.currentSession;
    }

    /**
     * Destroy switcher and cleanup
     */
    destroy(): void
    {
        this.console.debug (`Destroying HTTP switcher (sent ${this.byteCount} bytes, ${this.streamSwitchCount} switches)`);
        
        if (this.currentStream) {
            try {
                this.currentStream.end();
            } catch (e) {
                // Ignore
            }
            this.currentStream = undefined;
        }
        
        this.removeAllListeners();
    }
}
