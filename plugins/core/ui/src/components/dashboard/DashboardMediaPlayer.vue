<template>
  <div>
    <v-img v-if="albumArt" :src="albumArt" class="white--text">
      <v-card-title light class="align-end fill-height px-0 pb-0">
        <div style="width: 100%;">
          <div class="px-4 pb-2 pt-2" style="background: #0000007F;">
            <div v-if="metadata.title">{{ metadata.title }}</div>
            <div class="subtitle-1" v-if="metadata.albumArtist">{{ metadata.albumArtist }}</div>
          </div>
          <v-progress-linear :value="percent" color="orange"></v-progress-linear>
        </div>
      </v-card-title>
    </v-img>
    <v-list-item ripple :to="getDeviceViewPath(deviceId)">
      <v-list-item-icon>
        <v-icon
          x-small
          :color="device.paused ? 'blue' : device.running ? 'green' : '#a9afbb'"
        >{{ typeToIcon(device.type) }}</v-icon>
      </v-list-item-icon>
      <v-list-item-content>
        <v-list-item-title >{{ name || device.name }}</v-list-item-title>
      </v-list-item-content>
      <v-list-item-action class="mx-0 mt-0 mb-0">
        <span v-if="device.running">
          <v-btn icon small @click.prevent="device.skipPrevious()">
            <v-icon color="#a9afbb">skip_previous</v-icon>
          </v-btn>
          <v-btn icon small @click.prevent="device.paused ? device.start() : device.pause()">
            <v-icon color="blue">{{ device.paused ? 'play_arrow' : 'pause' }}</v-icon>
          </v-btn>
          <v-btn icon small @click.prevent="device.stop()">
            <v-icon color="red">stop</v-icon>
          </v-btn>
          <v-btn icon small @click.prevent="device.skipNext()">
            <v-icon color="#a9afbb">skip_next</v-icon>
          </v-btn>
        </span>
        <v-btn v-else icon small @click.prevent="device.stop()">
          <v-icon color="#a9afbb">stop</v-icon>
        </v-btn>
      </v-list-item-action>
    </v-list-item>
  </div>
</template>
<script>
import DashboardBase from "./DashboardBase";
import { ScryptedInterface } from "@scrypted/types";
import colors from "vuetify/es5/util/colors";
import { getDeviceViewPath, typeToIcon } from "../helpers";

export default {
  name: "DashboardMediaPlayer",
  props: ["name", "deviceId"],
  mixins: [DashboardBase],
  data() {
    return {
      mediaStatus: {},
      colors
    };
  },
  mounted() {
    var listener = this.device.listen(
      ScryptedInterface.MediaPlayer,
      (eventSource, eventDetails, eventData) => {
        this.mediaStatus = eventData || {};
      }
    );
    this.$once("destroyed", () => listener.removeListener());

    (async () => {
      this.mediaStatus = await this.device.getMediaStatus();
    })();

    this.ticker = setInterval(async () => {
      if (
        this.mediaStatus &&
        this.mediaStatus.position &&
        !this.device.paused &&
        this.device.running
      ) {
        this.mediaStatus.position += 1;
      }
    }, 1000);

    this.$once("destroyed", () => clearInterval(this.ticker));
  },
  methods: {
    getDeviceViewPath,
    typeToIcon,
  },
  computed: {
    albumArt() {
      const images =
        this.mediaStatus &&
        this.mediaStatus.metadata &&
        this.mediaStatus.metadata.images;
      if (!images || !images.length) {
        return;
      }
      return images[0].url;
    },
    metadata() {
      return (this.mediaStatus && this.mediaStatus.metadata) || {};
    },
    percent() {
      return (this.mediaStatus.position / this.mediaStatus.duration) * 100 || 0;
    }
  }
};
</script>