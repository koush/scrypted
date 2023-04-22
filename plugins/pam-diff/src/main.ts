import sdk, { MediaObject, ObjectDetection, ObjectDetectionCallbacks, ObjectDetectionGeneratorResult, ObjectDetectionGeneratorSession, ObjectDetectionModel, ObjectDetectionResult, ObjectDetectionSession, ObjectsDetected, ScryptedDeviceBase, VideoFrame } from '@scrypted/sdk';

import PD from 'pam-diff';
import P2P from 'pipe2pam';
import { PassThrough, Writable } from 'stream';

const defaultDifference = 9;
const defaultPercentage = 2;


class PamDiff extends ScryptedDeviceBase implements ObjectDetection {


    async * generateObjectDetectionsInternal(videoFrames: AsyncGenerator<VideoFrame, any, unknown>, session: ObjectDetectionGeneratorSession): AsyncGenerator<ObjectDetectionGeneratorResult, any, unknown> {
        videoFrames = await sdk.connectRPCObject(videoFrames);

        const width = 640;
        const height = 360;
        const p2p: Writable = new P2P();
        const pt = new PassThrough();
        const pamDiff = new PD({
            difference: parseInt(session.settings?.difference) || defaultDifference,
            percent: parseInt(session.settings?.percent) || defaultPercentage,
            response: session?.settings?.motionAsObjects ? 'blobs' : 'percent',
        });
        pt.pipe(p2p).pipe(pamDiff);

        const queued: ObjectsDetected[] = [];
        pamDiff.on('diff', async (data: any) => {
            const trigger = data.trigger[0];
            // console.log(trigger.blobs.length);
            const { blobs } = trigger;

            const detections: ObjectDetectionResult[] = [];
            if (blobs?.length) {
                for (const blob of blobs) {
                    detections.push(
                        {
                            className: 'motion',
                            score: 1,
                            boundingBox: [blob.minX, blob.minY, blob.maxX - blob.minX, blob.maxY - blob.minY],
                        }
                    )
                }
            }
            else {
                detections.push(
                    {
                        className: 'motion',
                        score: trigger.percent / 100,
                    }
                )
            }
            const event: ObjectsDetected = {
                timestamp: Date.now(),
                inputDimensions: [width, height],
                detections,
            }
            queued.push(event);
        });


        for await (const videoFrame of videoFrames) {
            const header = `P7
WIDTH ${width}
HEIGHT ${height}
DEPTH 3
MAXVAL 255
TUPLTYPE RGB
ENDHDR
`;

            const buffer = await videoFrame.toBuffer({
                resize: (videoFrame.width !== width || videoFrame.height !== height) ? {
                    width,
                    height,
                } : undefined,
                format: 'rgb',
            });
            pt.write(Buffer.from(header));
            pt.write(buffer);

            if (!queued.length) {
                yield {
                    __json_copy_serialize_children: true,
                    videoFrame,
                    detected: {
                        timestamp: Date.now(),
                        detections: [],
                    }
                }
            }
            while (queued.length) {
                yield {
                    __json_copy_serialize_children: true,
                    detected: queued.pop(),
                    videoFrame,
                };
            }
        }
    }


    async generateObjectDetections(videoFrames: AsyncGenerator<VideoFrame, any, unknown>, session: ObjectDetectionGeneratorSession): Promise<AsyncGenerator<ObjectDetectionGeneratorResult, any, unknown>> {
        return this.generateObjectDetectionsInternal(videoFrames, session);
    }

    async detectObjects(mediaObject: MediaObject, session?: ObjectDetectionSession, callbacks?: ObjectDetectionCallbacks): Promise<ObjectsDetected> {
        throw new Error('can not run motion detection on image')
    }

    async getDetectionModel(): Promise<ObjectDetectionModel> {
        return {
            name: '@scrypted/pam-diff',
            classes: ['motion'],
            inputFormat: 'rgb',
            inputSize: [640, 360],
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

export default PamDiff;
