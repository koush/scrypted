<template>
  <v-dialog
    v-model="dialog"
    width="1024"
    :disabled="disabled"
    :fullscreen="$isMobile()"
  >
    <template v-slot:activator="{ on }">
      <a v-on="on" v-if="!hidePreview"><v-img :src="src"></v-img></a>
    </template>
    <CameraViewer
  v-if="dialog"
    @clipPath="clipPath"
    @exitFullscreen="dialog = false"
    :clipPathValue="clipPathValue"
    :device="device"
    >
    </CameraViewer>
  </v-dialog>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import { createBlobUrl } from "../common/camera";
import { ScryptedInterface } from "@scrypted/types";
import cloneDeep from "lodash/cloneDeep";
import CameraViewer from "./CameraViewer.vue";

export default {
  components: {
    CameraViewer,
  },
  mixins: [RPCInterface],
  props: ["clipPathValue", "hidePreview", "showDialog"],
  data() {
    return {
      src: "images/cameraloading.jpg",
      dialog: false,
      disabled: !this.device.interfaces.includes(ScryptedInterface.VideoCamera),
    };
  },
  methods: {
    async refresh() {
      const picture = await this.device.takePicture();
      this.src = await createBlobUrl(this.$scrypted.mediaManager, picture);
    },
    clipPath(value) {
      this.$emit("clipPath", cloneDeep(value));
    },
      },
  watch: {
    showDialog() {
      this.dialog = this.showDialog;
    },
    async dialog(val) {
      this.$emit("dialog", val);
    },
  },
  mounted() {
    this.refresh();
  },
};
</script>
