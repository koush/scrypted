export interface ScriptDevice {
    handle<T>(handler?: T & object): void;
    handleTypes(...interfaces: string[]): void;
}
