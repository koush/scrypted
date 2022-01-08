<script>
import { createBlobUrl } from '../common/camera';
import Camera from "./Camera.vue";

export default {
  mixins: [Camera],
  methods: {
    async refresh() {
      const videoStream = await this.device.getVideoStream();
      this.src = await createBlobUrl(this.$scrypted.mediaManager, videoStream);
    },
  },
};
</script>
