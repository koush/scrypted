export function datePickerLocalTimeToUTC(value: string) {
    const d = new Date(value);
    // shift month/date to local time midnight.
    const dt = d.getTime() + new Date().getTimezoneOffset() * 60 * 1000;
    console.log(new Date(dt));
    return dt;
}
