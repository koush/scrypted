interface IntercomProfileClient {
    getProfiles(): Promise<{ $: { token: string } }[]>;
    getStreamUrl(profileToken: string): Promise<string>;
}

export async function getChannelIntercomStreamUrl(client: IntercomProfileClient, channel: number): Promise<string> {
    if (!Number.isSafeInteger(channel) || channel < 0)
        throw new Error('Invalid Reolink intercom channel');

    const profiles = await client.getProfiles();
    for (const profile of profiles) {
        const streamUrl = await client.getStreamUrl(profile.$.token);
        const pathname = new URL(streamUrl).pathname;
        // Hub/NVR RTSP paths use one-based channels; API channels are zero-based.
        const match = /^\/(?:h264)?Preview_(\d+)_main\/?$/i.exec(pathname);
        if (match && Number(match[1]) === channel + 1)
            return streamUrl;
    }

    throw new Error(`ONVIF main stream not found for Reolink channel ${channel}`);
}
