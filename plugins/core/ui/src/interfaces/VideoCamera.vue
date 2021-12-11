<script>
import Camera from "./Camera.vue";

export default {
  mixins: [Camera],
  methods: {
    async refresh() {
      const videoStream = await this.device.getVideoStream();
      this.$scrypted.mediaManager
        .convertMediaObjectToLocalUrl(videoStream, "image/jpeg")
        .then((result) => {
          this.picture = true;
          const url = new URL(result);
          this.src = url.pathname;
        });
    },
  },
};
</script>
