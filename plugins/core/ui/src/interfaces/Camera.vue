<template>
    <v-img contain :src="src" lazy-src="images/cameraloading.jpg" />
</template>

<script>
import RPCInterface from './RPCInterface.vue'

export default {
    mixins: [RPCInterface],
    data() {
        return {
            src: 'images/cameraloading.jpg',
        };
    },
    mounted() {
        (async() => {
            const videoStream = await this.device.takePicture();
            this.$scrypted.mediaManager
            .convertMediaObjectToLocalUrl(videoStream, "image/*")
            .then(result => {
                this.picture = true;
                const url = new URL(result);
                this.src = url.pathname;
            });
        })();
    }
};
</script>
