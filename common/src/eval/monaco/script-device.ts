export interface ScriptDevice {
    /**
     * @deprecated Use the default export to specify the device handler.
     * @param handler 
     */
    handle<T>(handler?: T & object): void;
    handleTypes(...interfaces: string[]): void;
}
