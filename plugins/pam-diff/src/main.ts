import { FFmpegInput, MediaObject, ObjectDetection, ObjectDetectionModel, ObjectDetectionSession, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { ffmpegLogInitialOutput } from "../../../common/src/media-helpers";

import child_process, { ChildProcess } from 'child_process';

import PD from 'pam-diff';
import P2P from 'pipe2pam';

const { mediaManager } = sdk;

const defaultDifference = 9;
const defaultPercentage = 15;

interface PamDiffSession {
    id: string;
    timeout?: NodeJS.Timeout;
    cp?: ChildProcess;
    pamDiff?: any;
}

class PamDiff extends ScryptedDeviceBase implements ObjectDetection {
    sessions = new Map<string, PamDiffSession>();

    endSession(pds: PamDiffSession) {
        this.sessions.delete(pds.id);
        const event: ObjectsDetected = {
            timestamp: Date.now(),
            running: false,
            detectionId: pds.id,
        }
        clearTimeout(pds.timeout);
        pds.cp.kill('SIGKILL');
        this.onDeviceEvent(ScryptedInterface.ObjectDetection, event);
    }

    reschedule(pds: PamDiffSession, duration: number) {
        clearTimeout(pds.timeout);
        pds.timeout = setTimeout(() => this.endSession(pds), duration);
    }

    async detectObjects(mediaObject: MediaObject, session?: ObjectDetectionSession): Promise<ObjectsDetected> {
        if (mediaObject && mediaObject.mimeType?.startsWith('image/'))
            throw new Error('can not run motion detection on image')

        let { detectionId } = session;
        let pds = this.sessions.get(detectionId);
        if (!mediaObject) {
            if (pds) {
                this.endSession(pds);
            }
            return {
                detectionId,
                running: false,
                timestamp: Date.now(),
            }
        }

        if (pds) {
            this.reschedule(pds, session.duration);
            pds.pamDiff.setDifference(session.settings?.difference || defaultDifference).setPercent(session.settings?.percent || defaultPercentage);
            return {
                detectionId,
                running: true,
                timestamp: Date.now(),
            };
        }

        const ffmpeg = await mediaManager.getFFmpegPath();
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(
            mediaObject,
            ScryptedMimeTypes.FFmpegInput
        )).toString());

        pds = {
            id: detectionId,
        }
        this.reschedule(pds, session.duration);

        const args = ffmpegInput.inputArguments.slice();
        args.unshift(
            '-hide_banner',
            '-loglevel',
            'error',
            '-hwaccel',
            'auto',
        )
        args.push(
            '-an', '-dn',
            '-c:v',
            'pam',
            '-pix_fmt',
            'rgb24',
            '-f',
            'image2pipe',
            '-vf',
            `fps=2,scale=640:360`,
            'pipe:3',
        );

        const p2p = new P2P();
        const pamDiff = new PD({
            difference: 9,
            percent: 75,
            response: 'percent',
        });

        // eslint-disable-next-line no-unused-vars
        pamDiff.on('diff', async (data) => {
            const event: ObjectsDetected = {
                timestamp: Date.now(),
                running: false,
                detectionId: pds.id,
                detections: [
                    {
                        className: 'motion',
                        score: data.trigger[0].percent / 100,
                    }
                ]
            }
            this.onDeviceEvent(ScryptedInterface.ObjectDetection, event);
        });

        this.console.log(args);

        pds.pamDiff = pamDiff;
        pds.pamDiff.setDifference(session.settings?.difference || defaultDifference).setPercent(session.settings?.percent || defaultPercentage);
        pds.cp = child_process.spawn(ffmpeg, args, {
            stdio:[ 'inherit', 'pipe', 'pipe', 'pipe']
        });
        pds.cp.stdio[3].pipe(p2p as any).pipe(pamDiff as any);
        pds.cp.on('exit', () => this.console.log('ffmpeg exited'))
        pds.cp.on('error', e => this.console.error('ffmpeg error', e))
        ffmpegLogInitialOutput(this.console, pds.cp);

        this.sessions.set(detectionId, pds);

        return {
            detectionId,
            running: true,
            timestamp: Date.now(),
        }
    }

    async getDetectionModel(): Promise<ObjectDetectionModel> {
        return {
            name: '@scrypted/pam-diff',
            classes: ['motion'],
            settings: [
                {
                    title: 'Motion Difference',
                    description: 'The color difference required to trigger motion on a pixel.',
                    key: 'difference',
                    value: this.storage.getItem('difference') || defaultDifference,
                    type: 'number',
                },
                {
                    title: 'Motion Percent',
                    description: 'The percentage of pixels required to trigger motion',
                    key: 'percent',
                    value: this.storage.getItem('percent]') || defaultPercentage,
                    type: 'number',
                }
            ]
        }
    }
}

export default new PamDiff();
