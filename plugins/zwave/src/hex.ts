export function isHex(s: string) {
    if (!s)
        return false;
    for (const c of s) {
        switch (c.toLowerCase()) {
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
            case 'a':
            case 'b':
            case 'c':
            case 'd':
            case 'e':
            case 'f':
                break;
            default: return false;
        }
    }
    return true;
}
