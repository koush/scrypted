<template>
  <div style="background: black; position: relative; overflow: hidden; width: 100%; height: 100%; display: flex;"
    @wheel="doTimeScroll">
    <ClipPathEditor v-if="clipPath" style="
        background: transparent;
        top: 0;
        left: 0;
        position: absolute;
        width: 100%;
        height: 100%;
        z-index: 2;
      " v-model="clipPath"></ClipPathEditor>


    <div style="position: relative; width: 100%; height: 100%;" :class="clipPath ? 'clip-path' : undefined">
      <video ref="video" style="
        background-color: black;
        width: 100%;
        height: 100%;
        z-index: 0;
        -webkit-transform-style: preserve-3d;
      " playsinline autoplay></video>

      <svg width="100%" height="100%" preserveAspectRatio="none" ref="svg" style="
        top: 0;
        left: 0;
        position: absolute;
        width: 100%;
        height: 100%;
        z-index: 1;
      " v-html="svgContents"></svg>

      <v-btn v-if="$isMobile()" @click="$emit('exitFullscreen')" small icon color="white"
        style="position: absolute; top: 10px; right: 10px; z-index: 3">
        <v-icon small>fa fa-times</v-icon></v-btn>

      <div style="position: absolute; bottom: 10px; right: 10px; z-index: 3">
        <v-dialog width="unset" v-model="dateDialog" v-if="showNvr">
          <template v-slot:activator="{ on }">
            <v-btn :dark="!isLive" v-on="on" small :color="isLive ? 'white' : 'blue'" :outlined="isLive">
              <v-icon small color="white" :outlined="isLive">fa fa-calendar-alt</v-icon>&nbsp;{{ monthDay }}</v-btn>
          </template>
          <vc-date-picker mode="date" :value="startTime" @input="datePicked"></vc-date-picker>
        </v-dialog>

        <v-btn v-if="showNvr" :dark="!isLive" small :color="isLive ? 'white' : adjustingTime ? 'green' : 'blue'"
          :outlined="isLive" @click="streamRecorder(Date.now() - 2 * 60 * 1000)">
          <v-btn v-if="!isLive && adjustingTime" small :color="isLive ? 'white' : adjustingTime ? 'green' : 'blue'"
            :outlined="isLive">
            {{ time }}</v-btn>
          <v-icon v-else small color="white" :outlined="isLive">fa fa-video</v-icon></v-btn>

        <v-btn small v-if="isLive && hasIntercom" @click="toggleMute" color="white" outlined>
          <v-icon v-if="muted" small color="white" :outlined="isLive">fa fa-microphone-slash
          </v-icon>
          <v-icon v-else small color="white" :outlined="isLive">fa fa-microphone
          </v-icon>
        </v-btn>

        <v-btn v-if="showNvr" :dark="!isLive" small color="red" :outlined="!isLive" @click="streamCamera">Live</v-btn>
      </div>
    </div>
  </div>
</template>

<script>
import { streamCamera, streamRecorder } from "../common/camera";
import { ScryptedInterface } from "@scrypted/types";
import ClipPathEditor from "../components/clippath/ClipPathEditor.vue";
import cloneDeep from "lodash/cloneDeep";
import { datePickerLocalTimeToUTC } from "../common/date";

export default {
  components: {
    ClipPathEditor,
  },
  props: ["clipPathValue", "device"],
  data() {
    const clipPath = this.clipPathValue ? cloneDeep(this.clipPathValue) : undefined;
    if (clipPath) {
      for (const point of clipPath) {
        point[0] = point[0] * .8 + 10;
        point[1] = point[1] * .8 + 10;
      }
    }

    return {
      dateDialog: false,
      adjustingTime: null,
      startTime: null,
      lastDetection: {},
      objectListener: this.device.listen(
        ScryptedInterface.ObjectDetector,
        (s, d, e) => {
          this.lastDetection = e || {};
        }
      ),
      muted: true,
      sessionControl: undefined,
      control: undefined,
      clipPath,
    };
  },
  computed: {
    hasIntercom() {
      return (
        this.device.interfaces.includes(ScryptedInterface.Intercom) ||
        this.device.providedInterfaces.includes(
          ScryptedInterface.RTCSignalingChannel
        )
      );
    },
    isLive() {
      return !this.startTime;
    },
    time() {
      const d = this.startTime ? new Date(this.startTime) : new Date();
      const h = d.getHours().toString().padStart(2, "0");
      const m = d.getMinutes().toString().padStart(2, "0");
      const s = d.getSeconds().toString().padStart(2, "0");
      return `${h}:${m}:${s}`;
    },
    monthDay() {
      const d = this.startTime ? new Date(this.startTime) : new Date();
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    },
    showNvr() {
      return this.device.interfaces.includes(ScryptedInterface.VideoRecorder);
    },
    svgWidth() {
      return this.lastDetection?.inputDimensions?.[0] || 1920;
    },
    svgHeight() {
      return this.lastDetection?.inputDimensions?.[1] || 1080;
    },
    svgContents() {
      if (!this.lastDetection) return "";

      let contents = "";

      const toPercent=  (v, d) => {
        return `${v / d * 100}%`;
      }

      for (const detection of this.lastDetection.detections || []) {
        if (!detection.boundingBox) continue;
        const s = "red";
        let x = detection.boundingBox[0];
        let y = detection.boundingBox[1];
        let w = detection.boundingBox[2];
        let h = detection.boundingBox[3];

        x = toPercent(x, this.lastDetection?.inputDimensions?.[0] || 1920);
        y = toPercent(y, this.lastDetection?.inputDimensions?.[1] || 1080);
        w = toPercent(w, this.lastDetection?.inputDimensions?.[0] || 1920);
        h = toPercent(h, this.lastDetection?.inputDimensions?.[1] || 1080);

        let t = ``;
        let toffset = 0;
        if (detection.score && detection.className !== 'motion') {
          t += `<tspan x='${x}' dy='${toffset}em'>${Math.round(detection.score * 100) / 100}</tspan>`
          toffset -= 1.2;
        }
        const tname = detection.className + (detection.id ? `: ${detection.id}` : '')
        t += `<tspan x='${x}' dy='${toffset}em'>${tname}</tspan>`

        const fs = 20;

        const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${s}" stroke-width="2" fill="none" />
        <text x="${x}" y="${y}" font-size="${fs}" dx="0.05em" dy="0.05em" fill="black">${t}</text>
        <text x="${x}" y="${y}" font-size="${fs}" fill="white">${t}</text>
      `;
        contents += box;
      }

      return contents;
    },
  },
  mounted() {
    this.streamCamera();
  },
  destroyed() {
    this.cleanupConnection();
    this.objectListener.removeListener();
  },
  methods: {
    datePicked(value) {
      this.dateDialog = false;
      if (value && value.getTime)
        this.streamRecorder(value.getTime());
    },
    doTimeScroll(e) {
      if (!this.device.interfaces.includes(ScryptedInterface.VideoRecorder))
        return;
      if (!this.startTime) {
        this.startTime = Date.now() - 2 * 60 * 1000;
        return;
      }
      const adjust = Math.round(e.deltaY / 7);
      this.startTime -= adjust * 60000;
      clearTimeout(this.adjustingTime);
      this.adjustingTime = setTimeout(() => {
        this.adjustingTime = null;
        this.streamRecorder(this.startTime);
      }, 10);
    },
    cleanupConnection() {
      console.log("control cleanup");
      this.sessionControl?.close();
      this.sessionControl = undefined;
    },
    async toggleMute() {
      this.muted = !this.muted;
      if (!this.sessionControl?.control) return;
      this.sessionControl.control.setPlayback({
        audio: !this.muted,
        video: true,
      });
      this.sessionControl.session.setMicrophone(true);
    },
    async streamCamera() {
      this.cleanupConnection();
      this.startTime = null;
      this.sessionControl = await streamCamera(
        this.$scrypted.mediaManager,
        this.device,
        () => this.$refs.video
      );
    },
    async streamRecorder(startTime) {
      this.startTime = startTime;
      const control = await streamRecorder(
        this.$scrypted.mediaManager,
        this.device,
        startTime,
        this.sessionControl?.recordingStream,
        () => this.$refs.video
      );
      if (control) {
        this.cleanupConnection();
        this.sessionControl = control;
      }
    },
  },
  watch: {
    clipPath() {
      const clipPath = cloneDeep(this.clipPath);
      for (const point of clipPath) {
        point[0] = (point[0] - 10) / .8;
        point[1] = (point[1] - 10) / .8;
      }
      this.$emit("clipPath", clipPath);
    },
  },
};
</script>
<style scoped>
.clip-path {
  transform: scale(.8)
}
</style>