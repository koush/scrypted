import { H264Profile, H264Level } from "../../hap";

export function profileToFfmpeg(profile: H264Profile): string {
    if (profile === H264Profile.HIGH)
        return "high";
    if (profile === H264Profile.MAIN)
        return "main";
    return "baseline";
}

export function levelToFfmpeg(level: H264Level): string {
    if (level === H264Level.LEVEL4_0)
        return '4.0';
    if (level === H264Level.LEVEL3_2)
        return '3.2';
    return '3.1';
}

// from werift
export function bufferWriter(bytes: number[], values: (number | bigint)[]) {
    const length = bytes.reduce((acc, cur) => acc + cur, 0);
    const buf = Buffer.alloc(length);
    let offset = 0;

    values.forEach((v, i) => {
        const size = bytes[i];
        if (size === 8) buf.writeBigUInt64BE(v as bigint, offset);
        else buf.writeUIntBE(v as number, offset, size);

        offset += size;
    });
    return buf;
}

// from werift
export const ntpTime = () => {
    const now = performance.timeOrigin + performance.now() - Date.UTC(1900, 0, 1);

    const seconds = now / 1000;
    const [sec, msec] = seconds.toString().split(".").map(Number);

    const buf = bufferWriter([4, 4], [sec, msec]);

    return buf.readBigUInt64BE();
};
