export function addH264VideoFilterArguments(videoArgs: string[], videoFilter: string,) {
    const filterIndex = videoArgs.findIndex(f => f === '-filter_complex');
    if (filterIndex !== undefined && filterIndex !== -1)
        videoArgs[filterIndex + 1] = videoArgs[filterIndex + 1] + `[unfilteredRecording] ; [unfilteredRecording] ${videoFilter}`;
    else
        videoArgs.push('-filter_complex', videoFilter);
}
