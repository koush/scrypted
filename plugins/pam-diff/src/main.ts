import { FFmpegInput, MediaObject, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionModel, ObjectDetectionSession, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "../../../common/src/media-helpers";

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
    callbacks: ObjectDetectionCallbacks;
}

class PamDiff extends ScryptedDeviceBase implements ObjectDetection {
    sessions = new Map<string, PamDiffSession>();

    endSession(id: string) {
        const pds = this.sessions.get(id);
        if (!pds)
            return;
        this.sessions.delete(pds.id);
        const event: ObjectsDetected = {
            timestamp: Date.now(),
            running: false,
            detectionId: pds.id,
        }
        clearTimeout(pds.timeout);
        safeKillFFmpeg(pds.cp);
        if (pds.callbacks) {
            pds.callbacks.onDetectionEnded(event);
        }
        else {
            this.onDeviceEvent(ScryptedInterface.ObjectDetection, event);
        }
    }

    reschedule(id: string, duration: number,) {
        const pds = this.sessions.get(id);
        if (!pds)
            return;
        clearTimeout(pds.timeout);
        pds.timeout = setTimeout(() => this.endSession(id), duration);
    }

    async detectObjects(mediaObject: MediaObject, session?: ObjectDetectionSession, callbacks?: ObjectDetectionCallbacks): Promise<ObjectsDetected> {
        if (mediaObject && mediaObject.mimeType?.startsWith('image/'))
            throw new Error('can not run motion detection on image')

        let { detectionId } = session;
        let pds = this.sessions.get(detectionId);
        if (pds)
            pds.callbacks = callbacks;

        if (!session?.duration) {
            this.endSession(detectionId);
            return {
                detectionId,
                running: false,
                timestamp: Date.now(),
            }
        }

        if (pds) {
            this.reschedule(detectionId, session.duration);
            pds.pamDiff.setDifference(session.settings?.difference || defaultDifference).setPercent(session.settings?.percent || defaultPercentage);
            return {
                detectionId,
                running: true,
                timestamp: Date.now(),
            };
        }

        // unable to start/extend this session.
        if (!mediaObject) {
            this.endSession(detectionId);
            return {
                detectionId,
                running: false,
                timestamp: Date.now(),
            }
        }

        const ffmpeg = await mediaManager.getFFmpegPath();
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(
            mediaObject,
            ScryptedMimeTypes.FFmpegInput
        )).toString());

        pds = {
            id: detectionId,
            callbacks,
        }
        this.reschedule(detectionId, session.duration);

        const args = ffmpegInput.inputArguments.slice();
        args.unshift(
            '-hide_banner',
            ...ffmpegInput.videoDecoderArguments || [],
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

        pamDiff.on('diff', async (data: any) => {
            const event: ObjectsDetected = {
                timestamp: Date.now(),
                running: true,
                detectionId: pds.id,
                detections: [
                    {
                        className: 'motion',
                        score: data.trigger[0].percent / 100,
                    }
                ]
            }
            if (pds.callbacks) {
                pds.callbacks.onDetection(event);
            }
            else {
                this.onDeviceEvent(ScryptedInterface.ObjectDetection, event);
            }
        });

        const console = sdk.deviceManager.getMixinConsole(mediaObject.sourceId, this.nativeId);

        pds.pamDiff = pamDiff;
        pds.pamDiff.setDifference(session.settings?.difference || defaultDifference).setPercent(session.settings?.percent || defaultPercentage);
        safePrintFFmpegArguments(console, args);
        pds.cp = child_process.spawn(ffmpeg, args, {
            stdio:[ 'inherit', 'pipe', 'pipe', 'pipe']
        });
        let pamTimeout: NodeJS.Timeout;
        const resetTimeout = () => {
            clearTimeout(pamTimeout);
            pamTimeout = setTimeout(() => {
                const check = this.sessions.get(detectionId);
                if (check !== pds)
                    return;
                console.error('PAM image stream timed out. Ending session.');
                this.endSession(detectionId);
            }, 60000);
        }
        p2p.on('data', () => {
            resetTimeout();
        })
        resetTimeout();
        pds.cp.stdio[3].pipe(p2p as any).pipe(pamDiff as any);
        pds.cp.on('exit', () => this.endSession(detectionId));
        ffmpegLogInitialOutput(console, pds.cp);

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
