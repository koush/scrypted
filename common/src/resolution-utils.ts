export function fitHeightToWidth(actualWidth: number, actualHeight: number, requestedWidth: number) {
    const h = Math.round((actualHeight / actualWidth) * requestedWidth);
    return h;
}
