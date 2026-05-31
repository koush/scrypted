import { writeFileSync } from "fs";
import { ffmpegFilterImage } from "../src/ffmpeg-image-filter";
import path from 'path';

async function main1() {
    const ret = await ffmpegFilterImage(['-i', '/Users/koush/Downloads/151-1678381127261.jpg'],
        {
            blur: true,
            //     // crop: {
            //     //     // fractional: true,
            //     //     left: 100,
            //     //     top: 100,
            //     //     width: 1000,
            //     //     height: 500,
            //     // }
            brightness: -.2,
            text: {
                fontFile: path.join(__dirname, '../fs/Lato-Bold.ttf'),
                text: 'Hello World',
            }
            // }
            // { "crop": { "left": 0.216796875, "top": 0.2552083333333333, "width": 0.318359375, "height": 0.17907714843749994, "fractional": true } 
        }
    );
    writeFileSync('test1.jpg', ret);
    console.log('test1 done');
}

main1();
