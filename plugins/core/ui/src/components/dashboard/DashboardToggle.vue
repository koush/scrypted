<template>
  <v-list-item ripple @click="showDevices()">
    <v-list-item-icon>
      <v-icon x-small :color="on ? 'orange' : '#a9afbb'">{{
        typeToIcon(type)
      }}</v-icon>
    </v-list-item-icon>
    <v-list-item-content>
      <v-list-item-title class="font-weight-light">{{
        name
      }}</v-list-item-title>
    </v-list-item-content>

    <v-list-item-action>
      <v-switch color="indigo" inset v-model="on" @click.stop></v-switch>
    </v-list-item-action>

    <v-overlay :value="showLightsDialog" opacity=".8">
      <v-container fluid>
        <v-card v-click-outside="maybeHideDialog" dark color="purple" raised>
          <v-card-title>
            <v-icon x-small color="white" style="margin-right: 20px">
              {{ typeToIcon(type) }}
            </v-icon>
            <span class="title font-weight-light">{{ name }}</span>
          </v-card-title>

          <v-flex xs12>
            <v-layout align-center justify-center column>
              <div v-if="type == 'Light'">
                <div class="slider-pad-bottom"></div>
                <vue-slider
                  :width="40"
                  :height="200"
                  ref="slider"
                  direction="btt"
                  :dotSize="60"
                  v-model="brightness"
                ></vue-slider>
                <div class="slider-pad-bottom"></div>
              </div>
              <v-list color="purple">
                <DashboardPopupToggle
                  :light="true"
                  v-for="device in devices"
                  :key="device.id"
                  :type="type"
                  :deviceId="device.id"
                  :name="device.name"
                ></DashboardPopupToggle>
              </v-list>
            </v-layout>
          </v-flex>
        </v-card>
      </v-container>
    </v-overlay>
  </v-list-item>
</template>
<script>
import DashboardBase from "./DashboardBase";
import DashboardPopupToggle from "./DashboardPopupToggle.vue";
import ClickOutside from "vue-click-outside";
import VueSlider from "vue-slider-component";
import "vue-slider-component/theme/default.css";
import { ScryptedInterface } from "@scrypted/types";
import throttle from "lodash/throttle";

export default {
  name: "DashboardToggle",
  props: ["name", "deviceIds", "type"],
  mixins: [DashboardBase],
  components: {
    VueSlider,
    DashboardPopupToggle,
  },
  directives: {
    ClickOutside,
  },
  data() {
    return {
      showLightsDialog: false,
      watchClickOutside: false,
    };
  },
  methods: {
    maybeHideDialog() {
      if (this.showLightsDialog && this.watchClickOutside) {
        this.showLightsDialog = false;
      }
    },
    showDevices() {
      if (this.showLightsDialog) {
        return;
      }
      this.showLightsDialog = true;
      this.watchClickOutside = false;
      setTimeout(() => {
        this.watchClickOutside = true;
      }, 300);
    },
    debounceSetBrightness: throttle(function (self) {
      self.deviceIds
        .map((id) => self.getDevice(id))
        .filter((device) =>
          device.interfaces.includes(ScryptedInterface.Brightness)
        )
        .forEach((device) => device.setBrightness(self._debouncedBrightness));
    }, 500),
  },
  computed: {
    brightness: {
      get() {
        const brightnessDevices = this.devices.filter((device) =>
          device.interfaces.includes(ScryptedInterface.Brightness)
        );
        if (!brightnessDevices.length) {
          return undefined;
        }
        const brightness = brightnessDevices.reduce(
          (brightness, device) => brightness + device.brightness,
          0
        );
        return brightness / brightnessDevices.length;
      },
      set(value) {
        this._debouncedBrightness = value;
        this.debounceSetBrightness(this);
      },
    },
    on: {
      get() {
        return this.devices.reduce((on, device) => on || device.on, false);
      },
      set(value) {
        this.devices.forEach((device) =>
          device[value ? "turnOn" : "turnOff"]()
        );
      },
    },
  },
};
</script>
<style>
.slider-pad-bottom {
  margin-bottom: 40px;
}
</style>