<template>
  <v-dialog v-model="dialog" width="1024" :disabled="disabled">
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
import { ScryptedInterface } from "@scrypted/sdk/types";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      pc: undefined,
      src: "images/cameraloading.jpg",
      dialog: false,
      disabled: !this.device.interfaces.includes(ScryptedInterface.VideoCamera),
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
    this.refresh();
  },
};
</script>
