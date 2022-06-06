<template>
  <v-card>
    <CardTitle v-if="!noTitle">Settings</CardTitle>
    <v-flex xs12 v-if="showChips" class="pt-0">
      <v-chip-group
        mandatory
        active-class="deep-purple accent-4 white--text"
        column
        v-model="settingsGroup"
      >
        <v-chip
          small
          :value="value"
          v-for="[key, value] of Object.entries(settingsGroups)"
          :key="key"
        >
          {{ key.replace("Settings", "") || "General" }}
        </v-chip>
        <v-chip small value="extensions" v-if="availableMixins.length">
          Integrations and Extensions
        </v-chip>
      </v-chip-group>
    </v-flex>

    <v-divider v-if="showChips"></v-divider>

    <v-flex xs12 v-if="settingsGroup !== 'extensions'">
      <div v-for="setting in settingsGroup" :key="setting.key">
        <Setting
          v-if="
            setting.value.choices ||
            setting.value.type === 'device' ||
            setting.value.type === 'interface' ||
            !setting.value.multiple
          "
          :device="device"
          v-model="setting.value"
          @input="onInput"
        ></Setting>
        <SettingMultiple v-else v-model="setting.value" :device="device">
        </SettingMultiple>
      </div>
    </v-flex>
    <AvailableMixins v-else :device="device"></AvailableMixins>

    <slot name="append"></slot>
  </v-card>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Setting from "./Setting.vue";
import SettingMultiple from "./SettingMultiple.vue";
import CardTitle from "../components/CardTitle.vue";
import AvailableMixins from "../components/AvailableMixins.vue";
import Mixin from "../components/Mixin.vue";
import { ScryptedInterface } from "@scrypted/types";

export default {
  components: {
    CardTitle,
    Setting,
    SettingMultiple,
    AvailableMixins,
  },
  mixins: [RPCInterface, Mixin],
  props: ["noTitle"],
  data() {
    return {
      settingsGroup: undefined,
      settings: [],
    };
  },
  watch: {
    device() {
      this.refresh();
    },
    settingsGroups() {
      if (this.settingsGroup === "extensions") return;
      this.settingsGroup = Object.entries(this.settingsGroups)?.[0]?.[1];
    },
  },
  mounted() {
    this.refresh();
  },
  computed: {
    ScryptedInterface() {
      return ScryptedInterface;
    },
    showChips() {
      let requiredChips = 1;
      if (this.availableMixins.length) requiredChips--;
      return Object.keys(this.settingsGroups).length > requiredChips;
    },
    settingsGroups() {
      const ret = {};
      for (const setting of this.settings) {
        const group = setting.value.group || "Settings";
        if (!ret[group]) {
          ret[group] = [];
        }
        ret[group].push(setting);
      }
      return ret;
    },
  },
  methods: {
    onChange() {},
    createInputValue(v) {
      return {
        settings: this.settings.map((setting) => setting.value),
      };
    },
    async refresh() {
      let settings;
      if (!this.device) {
        settings = this.value.settings;
      } else {
        settings = await this.rpc().getSettings();
      }
      this.settings = settings.map((setting) => ({
        key: setting.key,
        value: setting,
      }));
    },
  },
};
</script>
