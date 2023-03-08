import { TapoAPI } from '../src/tapo-api';
import { MpegTSWriter, StreamTypePCMATapo } from '../src/mpegts-writer';

const w = new MpegTSWriter();
w.AddPES(68, StreamTypePCMATapo)
w.WritePAT()
w.WritePMT()


if (!process.env.TAPO_PASSWORD)
    throw new Error('process.env.TAPO_PASSWORD undefined');

async function main() {
    const api = await TapoAPI.connect({
        cloudPassword: process.env.TAPO_PASSWORD!.toString(),
        address: '192.168.2.125:8800',
    });

    api.processMessages();
    await api.startMpegTsBackchannel();
}

main();
