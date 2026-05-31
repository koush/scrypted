const ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/;
const ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i;

export function isIPV4Address(ip: string) {
    return ipv4Regex.test(ip);
}

export function isIPV6Address(ip: string) {
    return ipv6Regex.test(ip);
}

export function isIPAddress(ip: string) {
    return isIPV4Address(ip) || isIPV6Address(ip);
}
