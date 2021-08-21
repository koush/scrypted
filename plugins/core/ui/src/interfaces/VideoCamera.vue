<template>
  <v-dialog v-model="dialog" width="1024">
    <template v-slot:activator="{ on }">
      <a v-on="on"
        ><v-img contain :src="src" lazy-src="images/cameraloading.jpg"></v-img
      ></a>
    </template>
    <video
      ref="video"
      width="100%"
      style="background-color: black"
      playsinline
      autoplay
    ></video>
  </v-dialog>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import { streamCamera } from "../common/camera";

const scryptedServerVariables = {};
scryptedServerVariables.registrationId = "web:/web/message";
scryptedServerVariables.senderId = null;
scryptedServerVariables.apiKey = "AIzaSyCBbKhH_IM1oIZMOO65xOnzgDDrmC2lAoc";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      pc: undefined,
      src: "images/cameraloading.jpg",
      dialog: false,
    };
  },
  destroyed() {
    this.cleanupConnection();
  },
  methods: {
    cleanupConnection() {
      if (this.pc) {
        this.pc.close();
        this.pc = undefined;
      }
    },
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
  mounted() {
    (async () => {
      const videoStream = await this.device.getVideoStream();
      this.$scrypted.mediaManager
        .convertMediaObjectToLocalUrl(videoStream, "image/jpeg")
        .then((result) => {
          this.picture = true;
          const url = new URL(result);
          this.src = url.pathname;
        });
    })();
  },
};
</script>
