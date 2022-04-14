<template>
  <v-dialog width="1024" v-model="dialog" :fullscreen="$isMobile()">
    <template v-slot:activator="{ on }">
      <v-img
        style="cursor: pointer"
        v-on="on"
        contain
        :src="src"
        lazy-src="images/cameraloading.jpg"
      ></v-img>
    </template>
    <div
      style="position: relative; overflow: hidden; width: 100%; height: 100%"
    >
      <video
        v-if="video"
        ref="video"
        width="100%"
        height="100%"
        style="background-color: black"
        playsinline
        autoplay
      ></video>
      <v-img
        v-else
        contain
        :src="src"
        lazy-src="images/cameraloading.jpg"
      ></v-img>
      <v-btn
        v-if="$isMobile()"
        @click="dialog = false"
        small
        icon
        color="white"
        style="position: absolute; top: 10px; right: 10px; z-index: 3"
      >
        <v-icon>fa fa-times</v-icon></v-btn
      >
    </div>
  </v-dialog>
</template>
<script>
import { ScryptedInterface } from "@scrypted/types";
import DashboardBase from "./DashboardBase";
import { createBlobUrl, streamCamera } from "../../common/camera";

const scryptedServerVariables = {};
scryptedServerVariables.registrationId = "web:/web/message";
scryptedServerVariables.senderId = null;
scryptedServerVariables.apiKey = "AIzaSyCBbKhH_IM1oIZMOO65xOnzgDDrmC2lAoc";

export default {
  name: "DashboardCamera",
  props: ["deviceId"],
  mixins: [DashboardBase],
  data() {
    return {
      pc: null,
      control: null,
      video: false,
      src: "images/cameraloading.jpg",
      overlay: false,
      dialog: false,
    };
  },
  watch: {
    async dialog(val) {
      this.cleanupConnection();
      if (!val) {
        return;
      }
      const { pc, control } = await streamCamera(
        this.$scrypted.mediaManager,
        this.device,
        () => this.$refs.video
      );
      this.pc = pc;
      this.control = control;
    },
  },
  methods: {
    cleanupConnection() {
      this.pc?.close();
      this.control?.endSession();
      this.pc = undefined;
      this.control = undefined;
    },
    async fetchCamera() {
      let picture;
      if (this.device.interfaces.includes(ScryptedInterface.Camera)) {
        picture = await this.device.takePicture();
      } else {
        picture = await this.device.getVideoStream();
      }
      this.src = await createBlobUrl(this.$scrypted.mediaManager, picture);
    },
  },
  mounted() {
    if (this.device.interfaces.includes(ScryptedInterface.RTCSignalingChannel))
      this.video = true;

    this.fetchCamera();
  },
};
</script>
