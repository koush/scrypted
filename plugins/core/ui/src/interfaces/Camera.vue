<template>
  <v-dialog v-model="dialog" width="1024" :disabled="disabled">
    <template v-slot:activator="{ on }">
      <a v-on="on" v-if="!hidePreview"
        ><v-img contain :src="src" lazy-src="images/cameraloading.jpg"></v-img
      ></a>
    </template>
    <div style="position: relative; overflow: hidden;">
      <video
        ref="video"
        style="background-color: black; width: 100%; height: 100%; z-index: 0;"
        playsinline
        autoplay
      ></video>
      <svg
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        ref="svg"
        style="top: 0; left: 0; position: absolute; width: 100%; height: 100%; z-index: 1;"
        v-html="svgContents"
      ></svg>
      <ClipPathEditor
        v-if="clipPath"
        style="background: transparent; top: 0; left: 0; position: absolute; width: 100%; height: 100%; z-index: 2;"
        v-model="clipPath"
      ></ClipPathEditor>
    </div>
  </v-dialog>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import { streamCamera } from "../common/camera";
import { ScryptedInterface } from "@scrypted/sdk/types";
import ClipPathEditor from "../components/clippath/ClipPathEditor.vue";
import cloneDeep from "lodash/cloneDeep";

export default {
  components: {
    ClipPathEditor,
  },
  mixins: [RPCInterface],
  props: ['clipPathValue', 'hidePreview', 'showDialog'],
  data() {
    return {
      lastDetection: {},
      objectListener: this.device.listen(
        ScryptedInterface.ObjectDetector,
        (s, d, e) => {
          this.lastDetection = e || {};
        }
      ),
      pc: undefined,
      src: "images/cameraloading.jpg",
      dialog: false,
      disabled: !this.device.interfaces.includes(ScryptedInterface.VideoCamera),
      clipPath: this.clipPathValue ? cloneDeep(this.clipPathValue) : undefined,
    };
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
        const sw = 2;
        const s = "red";
        const x = detection.boundingBox[0];
        const y = detection.boundingBox[1];
        const w = detection.boundingBox[2];
        const h = detection.boundingBox[3];
        const t = detection.className;
        const fs = 20;
        const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${s}" stroke-width="${sw}" fill="none" />
        <text x="${x}" y="${
          y - 5
        }" font-size="${fs}" dx="0.05em" dy="0.05em" fill="black">${t}</text>
        <text x="${x}" y="${y - 5}" font-size="${fs}" fill="white">${t}</text>`;
        contents += box;
      }

      return contents;
    },
  },
  destroyed() {
    this.cleanupConnection();
    this.objectListener.removeListener();
  },
  methods: {
    cleanupConnection() {
      if (this.pc) {
        this.pc.close();
        this.pc = undefined;
      }
    },
    async refresh() {
      const picture = await this.device.takePicture();
      this.$scrypted.mediaManager
        .convertMediaObjectToLocalUrl(picture, "image/*")
        .then((result) => {
          this.picture = true;
          const url = new URL(result);
          this.src = url.pathname;
        });
    },
  },
  watch: {
    showDialog() {
      this.dialog = this.showDialog;
    },
    clipPath() {
      this.$emit('clipPath', cloneDeep(this.clipPath));
    },
    async dialog(val) {
      this.cleanupConnection();
      this.$emit('dialog', val);
      if (!val) {
        return;
      }
      await streamCamera(
        this.$scrypted.mediaManager,
        this.device,
        () => this.$refs.video,
        (configuration) => (this.pc = new RTCPeerConnection(configuration))
      );
    },
  },
  mounted() {
    this.refresh();
  },
};
</script>
