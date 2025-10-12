import { Lock, LockState, Readme, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import { HikvisionDoorbellAPI } from "./doorbell-api";
import type { HikvisionCameraDoorbell } from "./main";
import * as fs from 'fs/promises';
import { join } from 'path';

export class HikvisionLock extends ScryptedDeviceBase implements Lock, Readme {

    constructor (public camera: HikvisionCameraDoorbell, nativeId: string, public doorNumber: string = '1') {
        super (nativeId);
        this.lockState = this.lockState || LockState.Unlocked;
        
        // Initialize lock state by attempting to close the lock
        this.initializeLockState();
    }

    /**
     * Initialize lock state by attempting to close the lock.
     * If close command succeeds, assume the lock is now locked.
     * If it fails, assume the lock state remains as default.
     */
    private async initializeLockState(): Promise<void>
    {
        try {
            const capabilities = await this.getClient().getDoorControlCapabilities();
            const command = capabilities.availableCommands.includes ('close') ? 'close' : 'resume';
            
            // Attempt to close/lock the door
            await this.getClient().controlDoor (this.doorNumber, command);
            
            // If successful, set state to Locked
            this.lockState = LockState.Locked;
            this.camera.console.info (`Lock ${this.doorNumber} initialized as Locked (close command succeeded)`);
            
        } catch (error) {
            // If command fails, keep default state
            this.camera.console.warn (`Lock ${this.doorNumber} initialization failed: ${error}. Using default state.`);
            this.lockState = LockState.Unlocked;
        }
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'LOCK_README.md');
        return fs.readFile (fileName, 'utf-8');
    }

    async lock(): Promise<void>
    {
        const capabilities = await this.getClient().getDoorControlCapabilities();
        const command = capabilities.availableCommands.includes ('close') ? 'close' : 'resume';
        await this.getClient().controlDoor (this.doorNumber, command);
    }

    async unlock(): Promise<void>
    {
        await this.getClient().controlDoor (this.doorNumber, 'open');
    }

    private getClient(): HikvisionDoorbellAPI {
        return this.camera.getClient();
    }

    static deviceInterfaces: string[] = [
        ScryptedInterface.Lock,
        ScryptedInterface.Readme
    ];
}
