export async function getNpmPackageInfo(pkg: string) {
    return fetchJSON(`https://registry.npmjs.org/${pkg}`);
}

export async function fetchJSON(url: string, init?: RequestInit) {
    return await (await fetch(url, init)).json();
}

export async function fetchBuffer(url: string, init?: RequestInit) {
    return Buffer.from(await (await fetch(url, init)).arrayBuffer());
}
