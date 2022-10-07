import { DenoisedDetectionOptions, DenoisedDetectionState, denoiseDetections } from '../src/denoise';

interface Test {

}

let options: DenoisedDetectionOptions<Test> = {
    added(detection) {
        console.log('added', detection.name, detection.boundingBox, detection.firstSeen, detection.lastSeen);
    },
    removed(detection) {
        console.log('removed', detection.name, detection.boundingBox, detection.firstSeen, detection.lastSeen);
    },
    retained(detection) {
        console.log('retained', detection.name, detection.boundingBox, detection.firstSeen, detection.lastSeen);
    },
    timeout: 30000,
}

let state: DenoisedDetectionState<Test> = {};
denoiseDetections(state, [
    {
        name: 'dog',
        boundingBox: [0, 0, .5, .5],
        detection: {},
    }
], {
    now: 1,
    ...options
});

denoiseDetections(state, [
    {
        name: 'dog',
        boundingBox: [.1, .1, .3, .3],
        detection: {},
    },
    {
        boundingBox: [.5, .5, .5, .5],
        name: 'dog',
        detection: {},
    }
], {
    now: 20000,
    ...options
});

denoiseDetections(state, [
    {
        name: 'dog',
        boundingBox: [.1, .1, .3, .3],
        detection: {},
    },
], {
    now: 20001,
    ...options
});

denoiseDetections(state, [
    {
        name: 'dog',
        boundingBox: [.15, .15, .3, .3],
        detection: {},
    },
], {
    now: 40001,
    ...options
});


denoiseDetections(state, [

], {
    now: 60001,
    ...options
});

