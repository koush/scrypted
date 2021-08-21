<template>
  <GmapMap
    :center="center"
    :zoom="zoom"
    ref="mapRef"
    style="height: 400px"
    :options="{
   mapTypeControl: false,
   fullscreenControl: false,
 }"
  >
    <GmapMarker v-if="position" :position="position" :label="lazyValue.name" />
  </GmapMap>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  computed: {
    center() {
      if (!this.position) {
        return {
          lat: 0,
          lng: 0
        };
      }
      return this.position;
    },
    zoom() {
      return !this.position ? 2 : 16;
    },
    position() {
      if (!this.lazyValue.position) {
        return;
      }
      return {
        lat: this.lazyValue.position.latitude,
        lng: this.lazyValue.position.longitude
      };
    }
  }
};
</script>