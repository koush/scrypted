import * as faceapi from "face-api.js";

export function makeBoundingBoxFromFace(face: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{
    detection: faceapi.FaceDetection;
}, faceapi.FaceLandmarks68>>
): [number, number, number, number] {
    return makeBoundingBox(face.detection.box);
}

export function makeBoundingBox(box: faceapi.Box<any>): [number, number, number, number] {
    return [box.x, box.y, box.width, box.height];
}
