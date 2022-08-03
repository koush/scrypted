export function safeParseJson(value: string) {
    try {
        return JSON.parse(value);
    }
    catch (e) {
    }
}
