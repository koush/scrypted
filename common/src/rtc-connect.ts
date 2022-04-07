import { RTCSignalingSendIceCandidate } from "@scrypted/sdk";
import type { RTCAVSignalingSetup, RTCSignalingSession } from "@scrypted/sdk/types";

function logSendCandidate(console: Console, type: string, session: RTCSignalingSession): RTCSignalingSendIceCandidate {
    return async (candidate) => {
        console.log(`${type} trickled candidate:`, candidate.candidate);
        return session.addIceCandidate(candidate);
    }
}

export async function connectRTCSignalingClients(
    console: Console,
    offerClient: RTCSignalingSession,
    offerSetup: Partial<RTCAVSignalingSetup>,
    answerClient: RTCSignalingSession,
    answerSetup: Partial<RTCAVSignalingSetup>
) {
    const offerOptions = await offerClient.getOptions();
    const answerOptions = await answerClient.getOptions();
    const disableTrickle = offerOptions?.disableTrickle || answerOptions?.disableTrickle;

    if (offerOptions?.offer && answerOptions?.offer)
        throw new Error('Both RTC clients have offers and can not negotiate. Consider implementing this in @scrypted/webrtc.');

    if (offerOptions?.requiresOffer && answerOptions.requiresOffer)
        throw new Error('Both RTC clients require offers and can not negotiate.');

    offerSetup.type = 'offer';
    answerSetup.type = 'answer';

    const offer = await offerClient.createLocalDescription('offer', offerSetup as RTCAVSignalingSetup,
        disableTrickle ? undefined : logSendCandidate(console, 'offer', answerClient));
    console.log('offer sdp', offer.sdp);
    await answerClient.setRemoteDescription(offer, answerSetup as RTCAVSignalingSetup);
    const answer = await answerClient.createLocalDescription('answer', answerSetup as RTCAVSignalingSetup,
        disableTrickle ? undefined : logSendCandidate(console, 'answer', offerClient));
    console.log('answer sdp', answer.sdp);
    await offerClient.setRemoteDescription(answer, offerSetup as RTCAVSignalingSetup);
}
