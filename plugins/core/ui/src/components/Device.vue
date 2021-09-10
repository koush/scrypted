<template>
  <v-layout wrap>
    <v-flex xs12 v-if="deviceComponent && deviceComponent === 'Script'">
      <component
        :is="deviceComponent"
        v-model="deviceData"
        :id="id"
        ref="componentCard"
      ></component>
    </v-flex>

    <v-flex xs12 v-if="showConsole" ref="consoleEl">
      <ConsoleCard :deviceId="id"></ConsoleCard>
    </v-flex>

    <v-flex xs12 v-if="showRepl" ref="replEl">
      <REPLCard :deviceId="id"></REPLCard>
    </v-flex>
    <v-flex xs12 md6 v-if="name != null">
      <v-layout row wrap>
        <v-flex xs12>
          <div v-if="deviceAlerts.length" class="pb-5">
            <v-alert
              dismissible
              @input="removeAlert(alert)"
              v-for="alert in deviceAlerts"
              :key="alert.id"
              xs12
              md6
              lg6
              outlined
              text
              color="primary"
              icon="mdi-vuetify"
              border="left"
            >
              <template v-slot:prepend>
                <v-icon class="white--text mr-3" size="sm" color="#a9afbb">{{
                  getAlertIcon(alert)
                }}</v-icon>
              </template>
              <div class="caption">{{ alert.title }}</div>
              <div
                v-linkified:options="{ className: 'alert-link' }"
                v-html="alert.message"
                style="color: white"
              ></div>
            </v-alert>
          </div>

          <v-card raised>
            <v-card-title class="orange-gradient subtitle-1 font-weight-light">
              {{ name || "No Device Name" }}
              <v-layout
                mr-1
                row
                justify-end
                align-center
                v-if="cardHeaderInterfaces.length"
              >
                <component
                  :value="deviceState"
                  :device="device"
                  :is="iface"
                  v-for="iface in cardHeaderInterfaces"
                  :key="iface"
                ></component>
              </v-layout>
            </v-card-title>

            <v-flex v-if="cardButtonInterfaces.length">
              <v-layout align-center justify-center>
                <component
                  v-for="iface in cardButtonInterfaces"
                  :key="iface"
                  :value="deviceState"
                  :device="device"
                  :is="iface"
                ></component>
              </v-layout>
            </v-flex>

            <v-form>
              <v-container>
                <v-layout>
                  <v-flex xs12>
                    <v-text-field
                      v-model="name"
                      label="Name"
                      required
                    ></v-text-field>
                    <v-select
                      v-if="inferredTypes.length > 1"
                      :items="inferredTypes"
                      label="Type"
                      outlined
                      v-model="type"
                    ></v-select>
                    <v-combobox
                      v-if="
                        hasFixedPhysicalLocation(type, deviceState.interfaces)
                      "
                      :items="existingRooms"
                      outlined
                      v-model="room"
                      label="Room"
                      required
                    ></v-combobox>
                  </v-flex>
                </v-layout>
              </v-container>
            </v-form>

            <v-card-actions>
              <component
                v-for="iface in cardActionInterfaces"
                :key="iface"
                :value="deviceState"
                :device="device"
                :is="iface"
              ></component>
              <v-spacer></v-spacer>

              <v-btn color="info" text @click="openConsole" v-if="!loading"
                >Console</v-btn
              >

              <v-btn color="info" text @click="openRepl" v-if="!loading"
                >REPL</v-btn
              >

              <v-btn color="info" text @click="openLogs" v-if="!loading"
                >Logs</v-btn
              >

              <v-dialog v-if="!loading" v-model="showDelete" width="500">
                <template v-slot:activator="{ on }">
                  <v-btn color="error" text v-on="on">Delete</v-btn>
                </template>

                <v-card>
                  <v-card-title
                    style="margin-bottom: 8px"
                    class="red font-weight-light white--text"
                    primary-title
                    >Delete Device</v-card-title
                  >

                  <v-card-text
                    >This will permanently delete the device. It can not be
                    undone.</v-card-text
                  >

                  <v-divider></v-divider>

                  <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text @click="showDelete = false"
                      >Cancel</v-btn
                    >
                    <v-btn color="red" text @click="remove"
                      >Delete Device</v-btn
                    >
                  </v-card-actions>
                </v-card>
              </v-dialog>

              <v-btn color="primary" v-if="!loading" text @click="save"
                >Save</v-btn
              >
            </v-card-actions>
          </v-card>
          <v-alert
            outlined
            v-model="showSave"
            dismissible
            close-text="Close Alert"
            type="success"
            >Saved.</v-alert
          >
          <v-alert
            outlined
            v-model="showSaveError"
            dismissible
            close-text="Close Alert"
            type="success"
            >There was an error while saving. Please check the logs.</v-alert
          >
        </v-flex>

        <v-flex xs12 v-if="!ownerDevice && pluginData">
          <v-card raised>
            <v-card-title
              class="green-gradient subtitle-1 text--white font-weight-light"
            >
              <font-awesome-icon size="sm" icon="database" />
              &nbsp;&nbsp;Plugin Management
            </v-card-title>
            <v-card-text></v-card-text>
            <v-container>
              <v-layout>
                <v-flex>
                  <v-btn outlined color="blue" @click="reloadPlugin"
                    >Reload Plugin</v-btn
                  >
                </v-flex>
              </v-layout></v-container
            >
            <v-card-actions>
              <v-btn text color="primary" @click="showStorage = !showStorage"
                >Storage</v-btn
              >

              <v-spacer></v-spacer>
              <v-btn
                v-if="!pluginData.updateAvailable"
                text
                color="blue"
                @click="openNpm"
                xs4
                >{{ pluginData.packageJson.name }}@{{
                  pluginData.packageJson.version
                }}</v-btn
              >
              <v-btn v-else color="orange" @click="doInstall" dark
                >Install Update {{ pluginData.updateAvailable }}</v-btn
              >
            </v-card-actions>
          </v-card>
        </v-flex>

        <v-flex xs12 v-if="deviceComponent && deviceComponent !== 'Script'">
          <component
            :is="deviceComponent"
            v-model="deviceData"
            :id="id"
            ref="componentCard"
          ></component>
        </v-flex>

        <v-flex xs12 v-if="ownerDevice && pluginData">
          <v-card raised>
            <v-card-title
              class="green-gradient subtitle-1 text--white font-weight-light"
            >
              <font-awesome-icon size="sm" icon="server" />
              &nbsp;&nbsp;Managed Device
            </v-card-title>
            <v-card-text></v-card-text>
            <v-card-text>
              <b>Native ID:</b>
              {{ pluginData.nativeId }}
            </v-card-text>
            <v-card-actions>
              <v-btn text color="primary" @click="showStorage = !showStorage"
                >Storage</v-btn
              >
              <v-spacer></v-spacer>
              <v-btn text color="blue" :to="`/device/${ownerDevice.id}`">{{
                ownerDevice.name
              }}</v-btn>
            </v-card-actions>
          </v-card>
        </v-flex>

        <v-flex xs12 v-if="availableMixins.length">
          <v-card raised>
            <v-card-title
              class="green-gradient subtitle-1 text--white font-weight-light"
            >
              <font-awesome-icon size="sm" icon="puzzle-piece" />
              &nbsp;&nbsp;Integrations and Extensions
            </v-card-title>

            <v-list-item-group>
              <v-list-item
                @click="
                  mixin.enabled = !mixin.enabled;
                  toggleMixin(mixin);
                "
                v-for="mixin in availableMixins"
                :key="mixin.id"
                inactive
              >
                <v-list-item-action>
                  <v-checkbox
                    @click.stop
                    @change="toggleMixin(mixin)"
                    v-model="mixin.enabled"
                    color="primary"
                  ></v-checkbox>
                </v-list-item-action>

                <v-list-item-content>
                  <v-list-item-title>{{ mixin.name }}</v-list-item-title>
                </v-list-item-content>

                <v-list-item-icon>
                  <v-list-item-action
                    ><v-btn icon @click.stop="openMixin(mixin)"
                      ><v-icon x-small>fa-external-link-alt</v-icon></v-btn
                    ></v-list-item-action
                  >
                </v-list-item-icon>
              </v-list-item>
            </v-list-item-group>
          </v-card>
        </v-flex>

        <v-flex xs12 v-if="showStorage">
          <v-card raised>
            <v-card-title
              class="green-gradient subtitle-1 text--white font-weight-light"
              >Storage</v-card-title
            >
            <v-form>
              <v-container>
                <v-layout>
                  <v-flex xs12>
                    <Storage
                      v-model="pluginData.storage"
                      @input="onChange"
                    ></Storage>
                  </v-flex>
                </v-layout>
              </v-container>
            </v-form>
          </v-card>
        </v-flex>

        <v-flex xs12>
          <v-card raised v-for="iface in cardUnderInterfaces" :key="iface">
            <v-card-title class="orange-gradient subtitle-1 font-weight-light">
              {{ iface }}
            </v-card-title>
            <component
              :value="deviceState"
              :device="device"
              :is="iface"
            ></component>
          </v-card>
        </v-flex>
      </v-layout>
    </v-flex>

    <v-flex xs12 md6 lg6>
      <v-layout row wrap>
        <v-flex xs12 v-for="iface in cardInterfaces" :key="iface">
          <v-card v-if="name != null">
            <v-card-title
              class="red-gradient white--text subtitle-1 font-weight-light"
              >{{ iface }}</v-card-title
            >
            <component
              :value="deviceState"
              :device="device"
              :is="iface"
            ></component>
          </v-card>
        </v-flex>

        <v-flex xs12 v-for="iface in noCardInterfaces" :key="iface">
          <component
            v-if="name != null"
            :value="deviceState"
            :device="device"
            :is="iface"
          ></component>
        </v-flex>

        <v-flex v-if="showLogs" ref="logsEl">
          <LogCard :rows="15" :logRoute="`/device/${id}/`"></LogCard>
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
  inferTypesFromInterfaces,
  getComponentWebPath,
  getDeviceViewPath,
  removeAlert,
  getAlertIcon,
  hasFixedPhysicalLocation,
} from "./helpers";
import { ScryptedInterface } from "@scrypted/sdk/types";
import Notifier from "../interfaces/Notifier.vue";
import OnOff from "../interfaces/OnOff.vue";
import Brightness from "../interfaces/Brightness.vue";
import Battery from "../interfaces/Battery.vue";
import Lock from "../interfaces/Lock.vue";
import ColorSettingHsv from "../interfaces/ColorSettingHsv.vue";
import ColorSettingRgb from "../interfaces/ColorSettingRgb.vue";
import OauthClient from "../interfaces/OauthClient.vue";
import Camera from "../interfaces/Camera.vue";
import VideoCamera from "../interfaces/VideoCamera.vue";
import Thermometer from "../interfaces/sensors/Thermometer.vue";
import HumiditySensor from "../interfaces/sensors/HumiditySensor.vue";
import EntrySensor from "../interfaces/sensors/EntrySensor.vue";
import MotionSensor from "../interfaces/sensors/MotionSensor.vue";
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
import MixinProvider from "../interfaces/MixinProvider.vue";
import Storage from "../common/Storage.vue";
import { checkUpdate, installNpm, getNpmPath } from "./plugin/plugin";
import AggregateDevice from "./aggregate/AggregateDevice.vue";
import Automation from "./automation/Automation.vue";
import Script from "./script/Script.vue";
import Javascript from "../interfaces/automation/Javascript.vue";
import Vue from "vue";
import {
  getDeviceAvailableMixins,
  setMixin,
  getDeviceMixins,
} from "../common/mixin";

const cardHeaderInterfaces = [
  ScryptedInterface.OccupancySensor,
  ScryptedInterface.EntrySensor,
  ScryptedInterface.MotionSensor,
  ScryptedInterface.AudioSensor,
  ScryptedInterface.HumiditySensor,
  ScryptedInterface.Thermometer,
  ScryptedInterface.Battery,
  ScryptedInterface.Lock,
  ScryptedInterface.OnOff,
];

const cardUnderInterfaces = [
  ScryptedInterface.DeviceProvider,
  ScryptedInterface.MixinProvider,
];

const noCardInterfaces = [ScryptedInterface.Settings];

const cardInterfaces = [
  ScryptedInterface.Brightness,
  ScryptedInterface.ColorSettingTemperature,
  ScryptedInterface.Notifier,
  ScryptedInterface.ColorSettingHsv,
  ScryptedInterface.ColorSettingRgb,
  ScryptedInterface.Camera,
  ScryptedInterface.VideoCamera,
  ScryptedInterface.TemperatureSetting,
  ScryptedInterface.PasswordStore,
  ScryptedInterface.PositionSensor,
  ScryptedInterface.Program,
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
    if (this.name == null) {
      return [];
    }
    let ret = interfaces.filter((iface) =>
      this.$store.state.systemState[this.id].interfaces.value.includes(iface)
    );

    if (ret.includes(ScryptedInterface.Camera)) {
      ret = ret.filter((iface) => iface !== ScryptedInterface.VideoCamera);
    }

    if (this.pluginData?.nativeId?.startsWith("script:")) {
      ret = ret.filter((iface) => iface !== ScryptedInterface.Program);
    }

    return ret;
  };
}

export default {
  components: {
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
    Notifier,
    Camera,
    VideoCamera,
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
    AudioSensor,
    OccupancySensor,

    OauthClient,
    HttpRequestHandler,

    VueSlider,
    LogCard,
    ConsoleCard,
    REPLCard,

    Storage,

    AggregateDevice,
    Automation,
    Program,
    Script,
  },
  data() {
    return this.initialState();
  },
  mounted() {
    if (this.needsLoad) {
      this.reload();
    }
    this.device.refresh?.(undefined, true);
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
    hasFixedPhysicalLocation,
    getComponentWebPath,
    removeAlert,
    getAlertIcon,
    initialState() {
      return {
        showLogs: false,
        showConsole: false,
        showRepl: false,
        showDelete: false,
        showSave: false,
        showSaveError: false,
        pluginData: undefined,
        name: undefined,
        room: undefined,
        type: undefined,
        loading: false,
        deviceComponent: undefined,
        deviceData: undefined,
        showStorage: false,
      };
    },
    openNpm() {
      window.open(getNpmPath(this.pluginData.packageJson.name), "npm");
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
    async doInstall() {
      await installNpm(this.pluginData.pluginId);
      this.reload();
    },
    async reload() {
      this.name = this.device.name;
      this.room = this.device.room;
      this.type = this.device.type;
      this.loading = true;
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      const pluginData = {
        updateAvailable: false,
      };
      pluginData.nativeId = await plugins.getNativeId(this.id);
      pluginData.pluginId = await plugins.getPluginId(this.id);
      pluginData.storage = await plugins.getStorage(this.id);
      pluginData.packageJson = await plugins.getPackageJson(
        pluginData.pluginId
      );
      this.pluginData = pluginData;
      checkUpdate(pluginData.pluginId, pluginData.packageJson.version).then(
        (updateAvailable) => (pluginData.updateAvailable = updateAvailable)
      );

      const device = this.device;
      if (pluginData.pluginId === "@scrypted/core") {
        const storage = await plugins.getStorage(device.id);
        this.deviceData = storage["data"];
        if (pluginData.nativeId?.startsWith("automation:")) {
          this.deviceComponent = "Automation";
        } else if (pluginData.nativeId?.startsWith("aggregate:")) {
          this.deviceComponent = "AggregateDevice";
        } else if (pluginData.nativeId?.startsWith("script:")) {
          this.deviceComponent = "Script";
          this.showConsole = true;
        }
      }

      this.loading = false;
    },
    remove() {
      const id = this.id;
      this.$router.replace("/device");
      this.$scrypted.systemManager.removeDevice(id);
    },
    async save() {
      this.showSaveError = false;
      this.showSave = false;
      try {
        const device = this.device;
        await device.setName(this.name);
        await device.setType(this.type);
        await device.setRoom(this.room);
        const plugins = await this.$scrypted.systemManager.getComponent(
          "plugins"
        );
        if (this.deviceData) {
          this.pluginData.storage.data = this.deviceData;
        }
        await plugins.setStorage(device.id, this.pluginData.storage);
        if (this.deviceData) {
          await this.$scrypted.deviceManager.onDeviceEvent(
            this.pluginData.nativeId,
            "Storage",
            null
          );
        }
        this.showSave = true;
      } catch (e) {
        this.showSaveError = true;
      }
    },
    openMixin(mixin) {
      this.$router.push(getDeviceViewPath(mixin.id));
    },
    async toggleMixin(mixin) {
      await setMixin(
        this.$scrypted.systemManager,
        this.device,
        mixin.id,
        mixin.enabled
      );
    },
  },
  asyncComputed: {
    availableMixins: {
      async get() {
        const mixins = await getDeviceMixins(
          this.$scrypted.systemManager,
          this.device
        );
        const availableMixins = await getDeviceAvailableMixins(
          this.$scrypted.systemManager,
          this.device
        );

        const ret = availableMixins.map((provider) => ({
          id: provider.id,
          name: provider.name,
          enabled: mixins.includes(provider.id),
        }));

        return ret;
      },
      watch: ["id"],
      default: [],
    },
  },
  computed: {
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
    cardInterfaces: filterInterfaces(cardInterfaces),
    noCardInterfaces: filterInterfaces(noCardInterfaces),
    cardUnderInterfaces: filterInterfaces(cardUnderInterfaces),
    cardHeaderInterfaces: filterInterfaces(cardHeaderInterfaces),
    inferredTypes() {
      return inferTypesFromInterfaces(
        this.device.type,
        this.device.providedType,
        this.device.interfaces
      );
    },
    existingRooms() {
      return this.$store.state.scrypted.devices
        .map(
          (device) => this.$scrypted.systemManager.getDeviceById(device).room
        )
        .filter((room) => room);
    },
    deviceAlerts() {
      return this.$store.state.scrypted.alerts.filter((alert) =>
        alert.path.startsWith(getDeviceViewPath(this.id))
      );
    },
    devices() {
      return this.$store.state.scrypted.devices;
    },
    id() {
      return this.$route.params.id;
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
};
</script>
<style>
a.alert-link {
  color: white;
}
</style>
