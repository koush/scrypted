// IMA-ADPCM (DVI-4) encoder for Baichuan's Talk audio blocks.
//
// Ported 1:1 from AlexxIT/go2rtc's pkg/baichuan/adpcm.go (MIT licensed),
// which is tested against real Reolink hardware including this doorbell
// family, and cross-checked against a live-tested Python port produced
// during this session's reverse-engineering. Two details matter and are
// easy to get wrong porting from other IMA-ADPCM references:
//
//   1. The predictor/step-index state PERSISTS across `encodeBlock()` calls
//      within one `AdpcmEncoder` instance - each 4-byte block header
//      records whatever the running state happens to be at the *start* of
//      that block, it is not reset to zero per block.
//   2. Within a byte, the FIRST sample's 4-bit code goes in the HIGH
//      nibble and the second sample's code in the LOW nibble. Getting this
//      backwards produces audio that is present but unrecognizable noise.

const STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
    157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
    724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
    3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

export class AdpcmEncoder {
    private predicted = 0;
    private index = 0;

    private encodeNibble(sample: number): number {
        const step = STEP_TABLE[this.index];
        let diff = sample - this.predicted;
        let nibble = 0;

        if (diff < 0) {
            nibble |= 8;
            diff = -diff;
        }

        let delta = step >> 3;
        if (diff >= step) {
            nibble |= 4;
            diff -= step;
            delta += step;
        }
        if (diff >= step >> 1) {
            nibble |= 2;
            diff -= step >> 1;
            delta += step >> 1;
        }
        if (diff >= step >> 2) {
            nibble |= 1;
            delta += step >> 2;
        }

        this.predicted = clamp(nibble & 8 ? this.predicted - delta : this.predicted + delta, -32768, 32767);
        this.index = clamp(this.index + INDEX_TABLE[nibble], 0, 88);

        return nibble;
    }

    /**
     * Encodes one block of 16-bit PCM samples (an even count, typically the
     * device's `lengthPerEncoder` from its TalkAbility response) into a
     * Baichuan ADPCM block: a 4-byte header (predictor state at the start
     * of this block) followed by one nibble per sample, two samples packed
     * per byte.
     */
    encodeBlock(pcm: Int16Array | number[]): Buffer {
        if (pcm.length === 0)
            throw new Error('adpcm block requires at least one sample');
        if (pcm.length % 2 !== 0)
            throw new Error(`adpcm block sample count must be even, got ${pcm.length}`);

        const out = Buffer.alloc(4 + pcm.length / 2);
        out.writeInt16LE(this.predicted, 0);
        out.writeUInt8(this.index & 0xff, 2);
        out.writeUInt8(0, 3);

        let writePos = 4;
        for (let i = 0; i < pcm.length; i += 2) {
            const first = this.encodeNibble(pcm[i]);
            const second = this.encodeNibble(pcm[i + 1]);
            out.writeUInt8((first << 4) | second, writePos);
            writePos++;
        }

        return out;
    }
}
