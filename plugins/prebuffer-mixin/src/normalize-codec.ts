export function normalizeCodec(codec: string) {
    codec = codec?.toLowerCase()?.replaceAll('.', '');
    // todo: more codecs from sdps
    switch (codec) {
        case 'pcm_ulaw':
            return 'pcm_mulaw';
        case 'h265':
            return 'hevc';
    }

    return codec;
}
