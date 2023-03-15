<template>
  <v-layout wrap>
    <v-flex xs12 v-if="deviceAlerts.length">
      <v-alert dark dismissible @input="removeAlert(alert)" v-for="alert in deviceAlerts" :key="alert.id" xs12 md6 lg6
        color="primary" icon="mdi-vuetify" border="left">
        <template v-slot:prepend>
          <v-icon class="white--text mr-3" size="sm" color="#a9afbb">{{
            getAlertIcon(alert)
          }}</v-icon>
        </template>
        <div class="caption">{{ alert.title }}</div>
        <div v-linkified:options="{ className: 'alert-link' }" v-html="alert.message.replace('origin:', origin)"></div>
      </v-alert>
    </v-flex>

    <v-flex v-for="iface in aboveInterfaces" :key="iface" xs12>
      <component v-if="noCardInterfaces.includes(iface)" :value="deviceState" :device="device" :is="iface"></component>
      <v-card v-else>
        <CardTitle>{{ getInterfaceFriendlyName(iface) }}</CardTitle>
        <component :value="deviceState" :device="device" :is="iface"></component>
      </v-card>
    </v-flex>

    <v-flex xs12 v-if="showConsole" ref="consoleEl">
      <ConsoleCard :deviceId="id"></ConsoleCard>
    </v-flex>

    <v-flex xs12 v-if="showRepl" ref="replEl">
      <REPLCard :deviceId="id"></REPLCard>
    </v-flex>
    <v-flex xs12 md7>
      <v-layout row wrap>
        <v-flex xs12 v-for="iface in leftAboveInterfaces" :key="iface" class="pb-0">
          <component v-if="noCardInterfaces.includes(iface)" :value="deviceState" :device="device" :is="iface">
          </component>
          <v-card v-else>
            <CardTitle>{{ getInterfaceFriendlyName(iface) }}</CardTitle>
            <component :value="deviceState" :device="device" :is="iface"></component>
          </v-card>
        </v-flex>
        <v-flex xs12 class="pb-0">
          <v-card raised>
            <v-card-title>
              {{ (device && device.name) || "No Device Name" }}
              <v-layout mr-1 row justify-end align-center v-if="cardHeaderInterfaces.length">
                <component :value="deviceState" :device="device" :is="iface" v-for="iface in cardHeaderInterfaces"
                  :key="iface"></component>
              </v-layout>
            </v-card-title>

            <v-card-subtitle v-if="ownerDevice && pluginData">
              <a @click="openDevice(ownerDevice.id)">{{ ownerDevice.name }}</a>
              (Native ID: {{ pluginData.nativeId }})
              <div></div>
            </v-card-subtitle>

            <v-flex v-if="cardButtonInterfaces.length">
              <v-layout align-center justify-center>
                <component v-for="iface in cardButtonInterfaces" :key="iface" :value="deviceState" :device="device"
                  :is="iface"></component>
              </v-layout>
            </v-flex>

            <v-card-actions v-if="!ownerDevice">
              <v-spacer></v-spacer>
              <v-btn small outlined color="blue" @click="reloadPlugin" class="mr-2">Reload Plugin</v-btn>
              <PluginAdvancedUpdate v-if="pluginData" :pluginData="pluginData" @installed="reload" />
            </v-card-actions>

            <v-card-actions>
              <component v-for="iface in cardActionInterfaces" :key="iface" :value="deviceState" :device="device"
                :is="iface"></component>
              <v-spacer></v-spacer>

              <v-btn color="info" text @click="openConsole">Console</v-btn>

              <v-tooltip bottom v-if="device.info && device.info.managementUrl">
                <template v-slot:activator="{ on }">
                  <v-btn x-small v-on="on" color="info" text @click="openManagementUrl">
                    <v-icon x-small>fa-wrench</v-icon>
                  </v-btn>
                </template>
                <span>Open Device Management Url</span>
              </v-tooltip>

              <v-tooltip bottom>
                <template v-slot:activator="{ on }">
                  <v-btn x-small v-on="on" color="info" text @click="openRepl">
                    <v-icon x-small>fa-terminal</v-icon>
                  </v-btn>
                </template>
                <span>REPL</span>
              </v-tooltip>

              <v-tooltip bottom>
                <template v-slot:activator="{ on }">
                  <v-btn x-small v-on="on" color="info" text @click="openLogs">
                    <v-icon x-small>fa-history</v-icon>
                  </v-btn>
                </template>
                <span>Events</span>
              </v-tooltip>

              <v-tooltip bottom v-if="pluginData">
                <template v-slot:activator="{ on }">
                  <v-btn x-small v-on="on" color="info" text @click="showStorage = !showStorage">
                    <v-icon x-small>fa-hdd</v-icon>
                  </v-btn>
                </template>
                <span>Storage</span>
              </v-tooltip>

              <v-dialog v-model="showDelete" width="500">
                <template #activator="{ on: dialog }">
                  <v-tooltip bottom>
                    <template #activator="{ on: tooltip }">
                      <v-btn x-small v-on="{ ...tooltip, ...dialog }" color="error" text>
                        <v-icon x-small>fa-trash</v-icon>
                      </v-btn>
                    </template>
                    <span>Delete</span>
                  </v-tooltip>
                </template>

                <v-card>
                  <CardTitle style="margin-bottom: 8px" class="red white--text" primary-title>Delete Device</CardTitle>

                  <v-card-text>This will permanently delete the device. It can not be
                    undone.</v-card-text>

                  <v-divider></v-divider>

                  <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text @click="showDelete = false">Cancel</v-btn>
                    <v-btn color="red" text @click="remove">Delete Device</v-btn>
                  </v-card-actions>
                </v-card>
              </v-dialog>
            </v-card-actions>
          </v-card>
        </v-flex>

        <v-flex xs12 v-if="deviceComponent && deviceComponent !== 'Script'">
          <component @save="saveStorage" :is="deviceComponent" v-model="deviceData" :id="id" ref="componentCard">
          </component>
        </v-flex>

        <v-flex xs12 v-for="iface in leftInterfaces" :key="iface" class="pb-0">
          <component v-if="noCardInterfaces.includes(iface)" :value="deviceState" :device="device" :is="iface">
          </component>
          <v-card v-else>
            <CardTitle>{{ getInterfaceFriendlyName(iface) }}</CardTitle>
            <component :value="deviceState" :device="device" :is="iface"></component>
          </v-card>
        </v-flex>

        <v-flex xs12 v-if="showStorage">
          <v-card raised>
            <CardTitle>Storage</CardTitle>
            <v-container>
              <v-layout>
                <v-flex xs12>
                  <Storage v-model="pluginData.storage" @input="onChange" @save="saveStorage"></Storage>
                </v-flex>
              </v-layout>
            </v-container>
          </v-card>
        </v-flex>
      </v-layout>
    </v-flex>

    <v-flex xs12 md5>
      <v-layout row wrap>
        <v-flex xs12 v-for="iface in rightInterfaces" :key="iface" class="pb-0">
          <component v-if="noCardInterfaces.includes(iface)" :value="deviceState" :device="device" :is="iface">
          </component>
          <v-card v-else>
            <CardTitle>{{ getInterfaceFriendlyName(iface) }}</CardTitle>
            <component :value="deviceState" :device="device" :is="iface"></component>
          </v-card>
        </v-flex>

        <v-flex v-if="showLogs" ref="logsEl">
          <LogCard :rows="15" :logRoute="`/device/${id}/`"></LogCard>
        </v-flex>

        <v-flex xs12
          v-if="!device.interfaces.includes(ScryptedInterface.Settings) && (availableMixins.length || deviceIsEditable(device))">
          <Settings :device="device"></Settings>
        </v-flex>
      </v-layout>
    </v-flex>
  </v-layout>
</template>
<script>
import VueSlider from "vue-slider-component";
import "vue-slider-component/theme/material.css";

import LogCard from "./builtin/LogCard.vue";
import ConsoleCard from "./ConsoleCard.vue";
import REPLCard from "./REPLCard.vue";
import {
  getComponentWebPath,
  getDeviceViewPath,
  removeAlert,
  getAlertIcon,
  hasFixedPhysicalLocation,
  getInterfaceFriendlyName,
  deviceIsEditable,
} from "./helpers";
import { ScryptedInterface } from "@scrypted/types";
import RTCSignalingClient from "../interfaces/RTCSignalingClient.vue";
import Notifier from "../interfaces/Notifier.vue";
import OnOff from "../interfaces/OnOff.vue";
import Brightness from "../interfaces/Brightness.vue";
import Battery from "../interfaces/Battery.vue";
import Lock from "../interfaces/Lock.vue";
import ColorSettingHsv from "../interfaces/ColorSettingHsv.vue";
import ColorSettingRgb from "../interfaces/ColorSettingRgb.vue";
import OauthClient from "../interfaces/OauthClient.vue";
import Camera from "../interfaces/Camera.vue";
import VideoClips from "../interfaces/VideoClips.vue";
import Thermometer from "../interfaces/sensors/Thermometer.vue";
import HumiditySensor from "../interfaces/sensors/HumiditySensor.vue";
import EntrySensor from "../interfaces/sensors/EntrySensor.vue";
import MotionSensor from "../interfaces/sensors/MotionSensor.vue";
import BinarySensor from "../interfaces/sensors/BinarySensor.vue";
import AudioSensor from "../interfaces/sensors/AudioSensor.vue";
import OccupancySensor from "../interfaces/sensors/OccupancySensor.vue";
import Settings from "../interfaces/Settings.vue";
import StartStop from "../interfaces/StartStop.vue";
import Dock from "../interfaces/Dock.vue";
import Pause from "../interfaces/Pause.vue";
import Program from "../interfaces/Program.vue";
import ColorSettingTemperature from "../interfaces/ColorSettingTemperature.vue";
import Entry from "../interfaces/Entry.vue";
import HttpRequestHandler from "../interfaces/HttpRequestHandler.vue";
import PasswordStore from "../interfaces/PasswordStore.vue";
import Scene from "../interfaces/Scene.vue";
import TemperatureSetting from "../interfaces/TemperatureSetting.vue";
import PositionSensor from "../interfaces/sensors/PositionSensor.vue";
import DeviceProvider from "../interfaces/DeviceProvider.vue";
import ObjectDetection from "../interfaces/ObjectDetection.vue";
import MixinProvider from "../interfaces/MixinProvider.vue";
import Readme from "../interfaces/Readme.vue";
import Scriptable from "../interfaces/automation/Scriptable.vue";
import Storage from "../common/Storage.vue";
import { checkUpdate } from "./plugin/plugin";
import Automation from "./automation/Automation.vue";
import PluginAdvancedUpdate from "./plugin/PluginAdvancedUpdate.vue";
import Vue from "vue";
import CardTitle from "../components/CardTitle.vue";
import colors from "vuetify/es5/util/colors";
import AvailableMixins from "./AvailableMixins.vue";
import Mixin from "./Mixin.vue";

const cardHeaderInterfaces = [
  ScryptedInterface.OccupancySensor,
  ScryptedInterface.EntrySensor,
  ScryptedInterface.MotionSensor,
  ScryptedInterface.BinarySensor,
  ScryptedInterface.AudioSensor,
  ScryptedInterface.HumiditySensor,
  ScryptedInterface.Thermometer,
  ScryptedInterface.Battery,
  ScryptedInterface.Lock,
  ScryptedInterface.OnOff,
];

const rightInterfaces = [
  ScryptedInterface.Brightness,
  ScryptedInterface.ColorSettingTemperature,
  ScryptedInterface.RTCSignalingClient,
  ScryptedInterface.Notifier,
  ScryptedInterface.ColorSettingHsv,
  ScryptedInterface.ColorSettingRgb,
  ScryptedInterface.VideoClips,
  ScryptedInterface.TemperatureSetting,
  ScryptedInterface.PasswordStore,
  ScryptedInterface.PositionSensor,
  ScryptedInterface.Program,
  ScryptedInterface.Settings,
  ScryptedInterface.MixinProvider,
];

const leftInterfaces = [
  ScryptedInterface.DeviceProvider,
  ScryptedInterface.Readme,
];
const leftAboveInterfaces = [
  ScryptedInterface.Camera,
];

const noCardInterfaces = [
  ScryptedInterface.Camera,
  ScryptedInterface.Settings,
  ScryptedInterface.Scriptable,
];

const aboveInterfaces = [
  ScryptedInterface.ObjectDetection,
  ScryptedInterface.Scriptable
];

const cardActionInterfaces = [
  ScryptedInterface.OauthClient,
  ScryptedInterface.HttpRequestHandler,
];

const cardButtonInterfaces = [
  ScryptedInterface.Dock,
  ScryptedInterface.Pause,
  ScryptedInterface.StartStop,
  ScryptedInterface.Entry,
  ScryptedInterface.Scene,
];

function filterInterfaces(interfaces) {
  return function () {
    if (!this.device) {
      return [];
    }
    let ret = interfaces.filter((iface) =>
      this.$store.state.systemState[this.id].interfaces.value.includes(iface)
    );

    if (this.pluginData?.nativeId?.startsWith("script:")) {
      ret = ret.filter((iface) => iface !== ScryptedInterface.Program);
    }

    return ret;
  };
}

export default {
  components: {
    CardTitle,
    AvailableMixins,

    DeviceProvider,
    MixinProvider,

    StartStop,
    Dock,
    Pause,
    Entry,
    Scene,

    Brightness,
    ColorSettingRgb,
    ColorSettingHsv,
    RTCSignalingClient,
    Notifier,
    Camera,
    VideoClips,
    PasswordStore,
    Settings,
    ColorSettingTemperature,
    TemperatureSetting,
    PositionSensor,

    Lock,
    OnOff,
    Battery,
    Thermometer,
    HumiditySensor,
    EntrySensor,
    MotionSensor,
    BinarySensor,
    AudioSensor,
    OccupancySensor,

    OauthClient,
    HttpRequestHandler,

    PluginAdvancedUpdate,
    VueSlider,
    LogCard,
    ConsoleCard,
    REPLCard,
    Readme,

    Storage,

    Automation,
    Program,
    Scriptable,

    ObjectDetection,
  },
  mixins: [Mixin],
  data() {
    return this.initialState();
  },
  mounted() {
    if (this.needsLoad) {
      this.reload();
    }
    this.device?.listen(undefined, (eventSource, eventDetails, eventData) => {
      if (eventDetails.eventInterface === "Storage") this.reloadStorage();
    });
  },
  destroyed() {
    this.cleanupListener();
  },
  watch: {
    devices() {
      // console.log('device change detected.');
    },
    id() {
      Object.assign(this.$data, this.initialState());
    },
    needsLoad() {
      if (this.needsLoad) {
        this.reload();
      }
    },
  },
  methods: {
    deviceIsEditable,
    getInterfaceFriendlyName,
    hasFixedPhysicalLocation,
    getComponentWebPath,
    removeAlert,
    getAlertIcon,
    initialState() {
      return {
        colors,
        showLogs: false,
        showConsole: false,
        showRepl: false,
        showDelete: false,
        pluginData: undefined,
        loading: false,
        deviceComponent: undefined,
        deviceData: undefined,
        showStorage: false,
      };
    },
    escapeHtml(html) {
      return html
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },
    async openConsole() {
      this.showConsole = !this.showConsole;
      if (this.showConsole) {
        await Vue.nextTick();
        this.$vuetify.goTo(this.$refs.consoleEl);
      }
    },
    openManagementUrl() {
      window.location = this.device.info.managementUrl;
    },
    async openRepl() {
      this.showRepl = !this.showRepl;
      if (this.showRepl) {
        await Vue.nextTick();
        this.$vuetify.goTo(this.$refs.replEl);
      }
    },
    async openLogs() {
      this.showLogs = !this.showLogs;
      if (this.showLogs) {
        await Vue.nextTick();
        this.$vuetify.goTo(this.$refs.logsEl);
      }
    },
    onChange() {
      // console.log(JSON.stringify(this.device));
    },
    cleanupListener() {
      if (this.listener) {
        this.listener.removeListener();
        return;
      }
    },
    getMetadata(prop) {
      const metadata = this.$store.state.systemState[this.id].metadata;
      return metadata && metadata.value && metadata.value[prop];
    },
    async reloadPlugin() {
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      await plugins.reload(this.pluginData.packageJson.name);
    },
    async reloadStorage() {
      if (!this.pluginData) return;

      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      this.pluginData.storage = await plugins.getStorage(this.id);
    },
    async reload() {
      this.loading = true;
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      const pluginData = {
        updateAvailable: false,
        versions: null,
      };
      const device = this.device;
      pluginData.nativeId = device.nativeId;
      pluginData.storage = await plugins.getStorage(this.id);
      pluginData.pluginId = this.device.pluginId;
      if (device.interfaces.includes(ScryptedInterface.ScryptedPlugin)) {
        pluginData.packageJson = await this.device.getPluginJson();
        checkUpdate(this.device.pluginId, pluginData.packageJson.version).then(
          (result) => Object.assign(pluginData, result)
        );
      }
      this.pluginData = pluginData;

      if (this.device.pluginId === "@scrypted/core") {
        const storage = await plugins.getStorage(device.id);
        this.deviceData = storage["data"];
        if (pluginData.nativeId?.startsWith("automation:")) {
          this.deviceComponent = "Automation";
        } else if (pluginData.nativeId?.startsWith("script:")) {
          this.deviceComponent = "Script";
          this.showConsole = true;
        }
      }

      this.loading = false;
    },
    remove() {
      const id = this.id;
      this.$router.back();
      this.$scrypted.systemManager.removeDevice(id);
    },
    async saveStorage() {
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      if (this.deviceData) {
        this.pluginData.storage.data = this.deviceData;
      }
      await plugins.setStorage(this.device.id, this.pluginData.storage);
    },
    openDevice(id) {
      this.$router.push(getDeviceViewPath(id));
    },
  },
  computed: {
    ScryptedInterface() {
      return ScryptedInterface;
    },
    origin() {
      return window.location.origin;
    },
    ownerDevice() {
      if (this.device.providerId === this.device.id) return;
      return this.$scrypted.systemManager.getDeviceById(this.device.providerId);
    },
    deviceState() {
      var ret = {};
      Object.entries(this.$store.state.systemState[this.id]).forEach(
        ([key, property]) => (ret[key] = property.value)
      );
      return ret;
    },
    cardButtonInterfaces: filterInterfaces(cardButtonInterfaces),
    cardActionInterfaces: filterInterfaces(cardActionInterfaces),
    leftInterfaces: filterInterfaces(leftInterfaces),
    leftAboveInterfaces: filterInterfaces(leftAboveInterfaces),
    noCardInterfaces: filterInterfaces(noCardInterfaces),
    rightInterfaces: filterInterfaces(rightInterfaces),
    cardHeaderInterfaces: filterInterfaces(cardHeaderInterfaces),
    aboveInterfaces: filterInterfaces(aboveInterfaces),
    deviceAlerts() {
      return this.$store.state.scrypted.alerts.filter((alert) =>
        alert.path.startsWith(getDeviceViewPath(this.id))
      );
    },
    devices() {
      return this.$store.state.scrypted.devices;
    },
    id() {
      return this.$route.params.id || this.$props.deviceId;
    },
    canLoad() {
      return this.devices.includes(this.id);
    },
    needsLoad() {
      return !this.pluginData && this.canLoad && !this.loading;
    },
    device() {
      return this.$scrypted.systemManager.getDeviceById(this.id);
    },
  },
  props: ['deviceId'],
};
</script>
<style>
a.alert-link {
  color: white;
}
</style>
</script>
<style scoped>
.shift-up {
  margin-top: -8px;
}
</style>