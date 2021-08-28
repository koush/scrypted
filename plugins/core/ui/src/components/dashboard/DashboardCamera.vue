<template>
  <div>
    <a @click="dialog = true">
      <v-img contain :src="src" lazy-src="images/cameraloading.jpg"></v-img>
    </a>

    <v-dialog v-model="dialog" width="1024">
      <video
        v-if="video"
        ref="video"
        width="100%"
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
    </v-dialog>
  </div>
</template>
<script>
import { ScryptedInterface } from "@scrypted/sdk/types";
import DashboardBase from "./DashboardBase";
import { streamCamera } from "../../common/camera";

var currentStream;

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
      video: false,
      src: 'images/cameraloading.jpg',
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
      await streamCamera(
        this.$scrypted.mediaManager,
        this.device,
        () => this.$refs.video,
        (configuration) => (this.pc = new RTCPeerConnection(configuration))
      );
    },
  },
  methods: {
    cleanupConnection() {
      if (this.pc) {
        this.pc.close();
        this.pc = undefined;
      }
    },
    async fetchCamera(media) {
      let picture;
      if (this.device.interfaces.includes(ScryptedInterface.Camera)) {
        picture = await this.device.takePicture();
      } else {
        picture = await this.device.getVideoStream();
      }
      const result = await this.$scrypted.mediaManager.convertMediaObjectToLocalUrl(
        picture,
        "image/jpeg"
      );
      const url = new URL(result);
      this.src = url.pathname;
    },
  },
  mounted() {
    if (this.device.interfaces.includes(ScryptedInterface.VideoCamera))
      this.video = true;

    if (this.device.interfaces.includes(ScryptedInterface.Camera)) {
      const picture = this.device.takePicture();
      this.fetchCamera(picture);
    } else if (this.device.interfaces.includes(ScryptedInterface.VideoCamera)) {
      const videoStream = this.device.getVideoStream();
      this.fetchCamera(videoStream);
    }
  },
};
</script>
