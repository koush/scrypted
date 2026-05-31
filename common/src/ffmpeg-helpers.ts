export function addVideoFilterArguments(videoArgs: string[], videoFilter: string, filterName = 'unfilteredRecording') {
    const filterIndex = videoArgs.findIndex(f => f === '-filter_complex');
    if (filterIndex !== undefined && filterIndex !== -1)
        videoArgs[filterIndex + 1] = videoArgs[filterIndex + 1] + `[${filterName}] ; [${filterName}] ${videoFilter}`;
    else
        videoArgs.push('-filter_complex', videoFilter);
}
