export interface InlineAcsEvent {
    major: number;
    minor: number;
    doorNo?: number;
}

/**
 * The alertStream push already carries the access-control event codes, so there is
 * no need to re-read the AcsEvent log for them. Returns undefined when the push has
 * no usable codes (the caller then falls back to polling the log).
 */
export function inlineAcsEvent (eventData: any): InlineAcsEvent | undefined
{
    const acs = eventData?.AccessControllerEvent;
    if (typeof acs?.majorEventType !== 'number' || typeof acs?.subEventType !== 'number') {
        return undefined;
    }
    return { major: acs.majorEventType, minor: acs.subEventType, doorNo: acs.doorNo };
}
