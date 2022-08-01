import { writeFileSync } from "fs";
import { ffmpegFilterImage } from "../src/ffmpeg-image-filter";
import path from 'path';

async function main() {
    const ret = await ffmpegFilterImage(['-i', 'rtsp://192.168.2.156:30846/dbf33252756466ed'],
        // {
        //     // blur:true,
        //     // crop: {
        //     //     // fractional: true,
        //     //     left: 100,
        //     //     top: 100,
        //     //     width: 1000,
        //     //     height: 500,
        //     // }
        //     // brightness: -.2,
        //     // text: {
        //     //     fontFile: path.join(__dirname, '../fs/Lato-Bold.ttf'),
        //     //     text: 'Hello World',
        //     // }
        // }
        { "crop": { "left": 0.216796875, "top": 0.2552083333333333, "width": 0.318359375, "height": 0.17907714843749994, "fractional": true } }
    );
    writeFileSync('test.jpg', ret);
}

main();
