import path from 'path';

// "optionalDependencies": {
//     "@greenlock/manager": "^3.1.0",
//     "@koush/greenlock": "^4.0.9",
//     "acme-dns-01-duckdns": "^3.0.1",
//     "greenlock-store-fs": "^3.2.2"
//  },

export async function registerDuckDns(duckDnsHostname: string, duckDnsToken: string): Promise<{
    cert: string;
    chain: string;
    privkey: string;
}> {
    const pluginVolume = process.env.SCRYPTED_PLUGIN_VOLUME;
    const greenlockD = path.join(pluginVolume, 'greenlock.d');

    const Greenlock = require('@koush/greenlock');
    const greenlock = Greenlock.create({
        packageRoot: process.env.NODE_PATH,
        configDir: greenlockD,
        packageAgent: 'Scrypted/1.0',
        maintainerEmail: 'koushd@gmail.com',
        notify: function (event, details) {
            if ('error' === event) {
                // `details` is an error object in this case
                console.error(details);
            }
        }
    });

    await greenlock.manager
        .defaults({
            challenges: {
                'dns-01': {
                    module: 'acme-dns-01-duckdns',
                    token: duckDnsToken,
                },
            },
            agreeToTerms: true,
            subscriberEmail: 'koushd@gmail.com',
        });

    const altnames = [duckDnsHostname];

    const r = await greenlock
        .add({
            subject: altnames[0],
            altnames: altnames
        });

    const result = await greenlock
        .get({ servername: duckDnsHostname });


    const { pems } = result;
    return pems;
}