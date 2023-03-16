<template>
    <v-sheet :height="600" width="100%" class="d-flex align-center justify-center flex-wrap text-center mx-auto"
        @drop="onDrop" @dragover="allowDrop">
        <div v-if="!img">Drag and Drop a JPG or PNG to analyze.</div>
        <div v-else style="position: relative; height: 100%;">
            <img :src="img" style="height: 100%">

            <svg v-if="lastDetection" :viewBox="`0 0 ${svgWidth} ${svgHeight}`" ref="svg" style="
                    top: 0;
                    left: 0;
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    z-index: 1;
                  " v-html="svgContents"></svg>


        </div>
    </v-sheet>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
export default {
    mixins: [RPCInterface],
    data() {
        return {
            img: null,
            lastDetection: null,
        }
    },
    mounted() {
    },
    computed: {
        svgWidth() {
            return this.lastDetection?.inputDimensions?.[0] || 1920;
        },
        svgHeight() {
            return this.lastDetection?.inputDimensions?.[1] || 1080;
        },
        svgContents() {
            if (!this.lastDetection) return "";

            let contents = "";

            for (const detection of this.lastDetection.detections || []) {
                if (!detection.boundingBox) continue;
                const svgScale = this.svgWidth / 1080;
                const sw = 6 * svgScale;
                const s = "red";
                const x = detection.boundingBox[0];
                const y = detection.boundingBox[1];
                const w = detection.boundingBox[2];
                const h = detection.boundingBox[3];
                let t = ``;
                let toffset = 0;
                if (detection.score && detection.className !== 'motion') {
                    t += `<tspan x='${x}' dy='${toffset}em'>${Math.round(detection.score * 100) / 100}</tspan>`
                    toffset -= 1.2;
                }
                const tname = detection.className + (detection.id ? `: ${detection.id}` : '')
                t += `<tspan x='${x}' dy='${toffset}em'>${tname}</tspan>`

                const fs = 30 * svgScale;

                const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${s}" stroke-width="${sw}" fill="none" />
        <text x="${x}" y="${y - 5}" font-size="${fs}" dx="0.05em" dy="0.05em" fill="black">${t}</text>
        <text x="${x}" y="${y - 5}" font-size="${fs}" fill="white">${t}</text>
      `;
                contents += box;
            }

            return contents;
        },
    },
    methods: {
        async onDrop(ev) {
            ev.preventDefault()
            const file = ev.dataTransfer.files[0];
            this.img = URL.createObjectURL(file);
            const buffer = Buffer.from(await file.arrayBuffer());
            const mediaManager = this.$scrypted.mediaManager;
            const mo = await mediaManager.createMediaObject(buffer, 'image/*');
            const detected = await this.rpc().detectObjects(mo);
            this.lastDetection = detected;
        },
        allowDrop(ev) {
            ev.preventDefault();
        }
    }
}
</script>
