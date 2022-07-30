import { writeFileSync } from "fs";
import {ffmpegFilterImage} from "../src/ffmpeg-image-filter";
import path from 'path';

async function main() {
    const ret = await ffmpegFilterImage(['-i', 'rtsp://192.168.2.156:30846/dbf33252756466ed'], {
        blur:true,
        // crop: {
        //     fractional: true,
        //     left: .25,
        //     top: .25,
        //     width: .5,
        //     height: .5,
        // }
        brightness: -.2,
        text: {
            fontFile: path.join(__dirname, '../fs/Lato-Bold.ttf'),
            text: 'Hello World',
        }
    });
    writeFileSync('test.jpg', ret);
}

main();
