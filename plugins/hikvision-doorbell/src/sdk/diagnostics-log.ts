import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * JSON-lines log for the SDK observation run. Keeps one rotated copy (<file>.1),
 * so the total stays under twice the cap. Write failures are ignored: diagnostics
 * must never break call detection.
 */
export class DiagnosticsLog
{
    private size = 0;

    constructor (private filePath: string, private maxBytes = 5 * 1024 * 1024)
    {
        try {
            mkdirSync (dirname (filePath), { recursive: true });
            this.size = statSync (filePath).size;
        }
        catch {
            this.size = 0;
        }
    }

    append (kind: string, payload: unknown): void
    {
        const line = JSON.stringify ({ t: new Date().toISOString(), kind, payload }) + '\n';
        const length = Buffer.byteLength (line);
        try {
            if (this.size > 0 && this.size + length > this.maxBytes) {
                renameSync (this.filePath, this.filePath + '.1');
                this.size = 0;
            }
            appendFileSync (this.filePath, line);
            this.size += length;
        }
        catch {
        }
    }
}
