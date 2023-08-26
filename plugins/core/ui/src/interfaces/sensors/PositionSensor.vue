<template>
  <l-map
    :center="center"
    :zoom="zoom"
    style="height: 400px;"
    :options="{
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      doubleClickZoom: false,
      boxZoom: false,
      scrollWheelZoom: false,
    }"
  >
    <l-tile-layer :url="url" :attribution="attribution"></l-tile-layer>
    <l-marker :lat-lng="position" :icon="icon"></l-marker>
    <l-control-attribution position="bottomright" :prefix="prefix"></l-control-attribution>
  </l-map>
</template>

<script>
import { latLng, icon } from "leaflet";
import { LMap, LTileLayer, LMarker, LControlAttribution } from "vue2-leaflet";
import 'leaflet/dist/leaflet.css';
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  components: {
    LMap,
    LTileLayer,
    LMarker,
    LControlAttribution,
  },
  data () {
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      prefix: '<a target="blank" href="https://leafletjs.com/">Leaflet</a>',
      attribution: '&copy; <a target="_blank" href="http://osm.org/copyright">OpenStreetMap</a> contributors',
      icon: icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      }),
    };
  },
  computed: {
    center() {
      return this.position;
    },
    zoom() {
      return !this.position ? 2 : 16;
    },
    position() {
      if (!this.lazyValue.position) {
        return latLng(0, 0);
      }
      return latLng(this.lazyValue.position.latitude, this.lazyValue.position.longitude);
    }
  }
};
</script>