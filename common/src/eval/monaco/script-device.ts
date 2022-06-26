export interface ScriptDevice {
    /**
     * @deprecated Use export default instead.
     * @param handler 
     */
    handle<T>(handler?: T & object): void;
    handleTypes(...interfaces: string[]): void;
}
