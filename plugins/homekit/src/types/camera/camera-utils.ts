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
