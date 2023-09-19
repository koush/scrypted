import { once } from 'events';
import { http, https } from 'follow-redirects';
import { RequestOptions, IncomingMessage } from 'http';

export async function getNpmPackageInfo(pkg: string) {
    const { json } = await fetchJSON(`https://registry.npmjs.org/${pkg}`, {
        // force ipv4 in case of busted ipv6.
        family: 4,
    });
    return json;
}

export async function fetchJSON(url: string, init?: RequestOptions) {
    init ||= {};
    init.headers = {
        ...init.headers,
        Accept: 'application/json',
    };
    const { body, headers } = await fetchBuffer(url, init);
    return {
        json: JSON.parse(body.toString()),
        headers,
    }
}

export async function fetchPostJSON(url: string, postBody: any, init?: RequestOptions) {
    init ||= {};
    init.method = 'POST';
    init.headers = {
        ...init.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };

    const { body, headers } = await fetchBuffer(url, init, Buffer.from(JSON.stringify(postBody)));
    return {
        json: JSON.parse(body.toString()),
        headers,
    }
}

export async function fetchBuffer(url: string, init?: RequestOptions, body?: Buffer) {
    const proto = url.startsWith('https:') ? https : http;

    const request = proto.request(url, {
        ...init,
    });
    if (body)
        request.write(body);
    request.end();
    const [response] = await once(request, 'response') as IncomingMessage[];

    const buffers: Buffer[] = [];
    response.on('data', buffer => buffers.push(buffer));
    await once(response, 'end');

    return {
        headers: response.headers,
        body: Buffer.concat(buffers),
    };
}
