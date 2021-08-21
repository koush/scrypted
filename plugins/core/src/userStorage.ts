export class UserStorage implements Storage {
    username: string;

    constructor(username: string) {
        this.username = username;
    }

    get length(): number {
        return this.keys().length;
    }

    private keys(): string[] {
        var ret: string[] = [];
        for (var i = 0; i < localStorage.length; i++) {
            ret.push(localStorage.key(i));
        }
        return ret.filter(key => key.startsWith(`${this.username}-`));
    }

    prefixKey(key: string) {
        return `${this.username}-${key}`;
    }

    clear(): void {
        this.keys().forEach(key => this.removeItem(key));
    }
    getItem(key: string): string {
        return localStorage.getItem(this.prefixKey(key));
    }
    key(index: number): string {
        return this.keys()[index];
    }
    removeItem(key: string): void {
        return localStorage.removeItem(this.prefixKey(key));
    }
    setItem(key: string, value: string): void {
        return localStorage.setItem(this.prefixKey(key), value);
    }
}