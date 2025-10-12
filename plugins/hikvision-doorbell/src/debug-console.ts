import { Console } from 'console';

/**
 * Interface for managing debug state
 */
export interface DebugController {
    setDebugEnabled(enabled: boolean): void;
    getDebugEnabled(): boolean;
}

/**
 * Mutates an existing Console object to provide conditional debug output
 * @param console - The console object to mutate
 * @returns Controller object for managing debug state
 */
export function makeDebugConsole(console: Console): DebugController {
    let debugEnabled = process.env.DEBUG === 'true' || 
                      process.env.NODE_ENV === 'development';
    
    // Store original debug method
    const originalDebug = console.debug.bind (console);
    
    // Replace debug method with conditional version
    console.debug = (message?: any, ...optionalParams: any[]): void => {
        if (debugEnabled) 
        {
            const now = new Date();
            const timestamp = now.toISOString();
            originalDebug (`[DEBUG ${timestamp}] ${message}`, ...optionalParams);
        }
    };
    
    // Return controller for managing debug state
    return {
        setDebugEnabled(enabled: boolean): void {
            debugEnabled = enabled;
        },
        
        getDebugEnabled(): boolean {
            return debugEnabled;
        }
    };
}
