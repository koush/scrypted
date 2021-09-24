function rd() {
    return Math.round(Math.random() * 100000) % 10;
}

export function randomPinCode() {
    return `${rd()}${rd()}${rd()}-${rd()}${rd()}-${rd()}${rd()}${rd()}`;
}
