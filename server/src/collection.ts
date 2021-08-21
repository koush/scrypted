export function hasSameElements<T>(a: T[], b: T[]): boolean {
    const s1 = new Set(a);
    const s2 = new Set(b);
    if (s1.size != s2.size)
        return false;
    for (const e of s1) {
        if (!s2.has(e))
            return false;
    }

    return true;
}
