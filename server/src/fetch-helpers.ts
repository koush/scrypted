export async function getNpmPackageInfo(pkg: string) {
    return fetchJSON(`https://registry.npmjs.org/${pkg}`);
}

export async function fetchJSON(url: string, init?: RequestInit) {
    return await (await fetch(url, init)).json();
}

export async function fetchPostJSON(url: string, body: any, init?: RequestInit) {
    init ||= {};
    init.body = JSON.stringify(body);
    init.method = 'POST';
    init.headers = {
        ...init.headers,
        'Content-Type': 'application/json',
    };
    return await (await fetch(url, init)).json();
}

export async function fetchBuffer(url: string, init?: RequestInit) {
    return Buffer.from(await (await fetch(url, init)).arrayBuffer());
}
