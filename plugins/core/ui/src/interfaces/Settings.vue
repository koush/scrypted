<template>
  <v-card>
    <CardTitle v-if="!noTitle">Settings</CardTitle>
    <v-flex xs12 v-if="showChips">
      <v-chip-group class="pt-0" mandatory active-class="deep-purple accent-4 white--text" column
        v-model="settingsGroupName">
        <v-chip small :value="key" v-for="[key] of Object.entries(settingsGroups)" :key="key">
          {{ key.replace("Settings", "") || "General" }}
        </v-chip>
        <v-chip small value="extensions" v-if="availableMixins.length">
          <v-avatar left>
            <v-icon x-small>fas fa-bolt</v-icon>
          </v-avatar>
          Extensions
        </v-chip>
      </v-chip-group>
    </v-flex>

    <v-divider v-if="showChips"></v-divider>

    <CardTitle v-if="settingsSubgroups">Settings > {{ settingsGroupName }}</CardTitle>
    <v-flex xs12 v-if="settingsSubgroups">
      <v-chip-group class="pt-0" mandatory active-class="deep-purple accent-4 white--text" column
        v-model="settingsSubgroupName">
        <v-chip small :value="key" v-for="key of settingsSubgroups" :key="key">
          {{ key }}
        </v-chip>
      </v-chip-group>
    </v-flex>

    <v-divider v-if="settingsSubgroups"></v-divider>

    <CardTitle v-if="settingsSubgroups">Settings > {{ settingsGroupName }} >  {{ settingsSubgroupName }}</CardTitle>

    <v-flex xs12 v-if="settingsGroupName !== 'extensions' || !showChips">

      <div v-for="setting in settingsSubgroup" :key="setting.key">
        <Setting v-if="
        setting.value.choices ||
        setting.value.type === 'device' ||
        setting.value.type === 'interface' ||
        !setting.value.multiple" v-model="setting.value" @input="onInput"
          :device="needsDevice(setting) ? device : undefined">
        </Setting>
        <SettingMultiple v-else v-model="setting.value" :device="needsDevice(setting) ? device : undefined"
          @input="onInput">
        </SettingMultiple>
      </div>
    </v-flex>
    <AvailableMixins v-else :device="device"></AvailableMixins>

    <slot name="append"></slot>
    <v-card-actions v-if="device">
      <v-spacer></v-spacer>
      <v-btn @click="save" :disabled="!dirty" small>Save</v-btn>
    </v-card-actions>
  </v-card>
</template>
<script>
import { ScryptedInterface } from "@scrypted/types";
import Vue from 'vue';
import AvailableMixins from "../components/AvailableMixins.vue";
import CardTitle from "../components/CardTitle.vue";
import { deviceIsEditable, hasFixedPhysicalLocation, inferTypesFromInterfaces } from "../components/helpers";
import Mixin from "../components/Mixin.vue";
import RPCInterface from "./RPCInterface.vue";
import Setting from "./Setting.vue";
import SettingMultiple from "./SettingMultiple.vue";

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
      rawSettingsSubgroupName: undefined,
      rawSettingsGroupName: undefined,
      deviceSettings: [],
    };
  },
  watch: {
    device() {
      this.refresh();
    },
  },
  mounted() {
    this.refresh();
  },
  computed: {
    settingsGroupName: {
      get() {
        if (this.rawSettingsGroupName)
          return this.rawSettingsGroupName;
        return Object.keys(this.settingsGroups)?.[0] || 'extensions';
      },
      set(value) {
        this.rawSettingsGroupName = value;
      },
    },
    settingsSubgroupName: {
      get() {
        if (!this.settingsSubgroups)
          return;
        if (this.settingsSubgroups.findIndex(sg => sg === this.rawSettingsSubgroupName) !== -1)
          return this.rawSettingsSubgroupName;
        return Object.keys(this.settingsSubgroups)?.[0];
      },
      set(value) {
        this.rawSettingsSubgroupName = value;
      },
    },
    settings() {
      const settings = [];

      if (deviceIsEditable(this.device)) {
        const inferredTypes = inferTypesFromInterfaces(
          this.device.type,
          this.device.providedType,
          this.device.interfaces
        );

        const editables = [
          {
            group: 'Edit',
            key: '__name',
            title: 'Name',
            value: this.device.name,
          },
        ];
        if (inferredTypes.length > 1) {
          editables.push(
            {
              group: 'Edit',
              key: '__type',
              title: 'Type',
              value: this.device.type,
              choices: inferredTypes,
            },
          );
        }
        const existingRooms = this.$store.state.scrypted.devices
          .map(
            (device) => this.$scrypted.systemManager.getDeviceById(device).room
          )
          .filter((room) => room);

        if (hasFixedPhysicalLocation(this.device.type, this.device.interfaces)) {
          editables.push(
            {
              group: 'Edit',
              key: '__room',
              title: 'Room',
              value: this.device.room,
              combobox: true,
              choices: existingRooms,
            },
          );
        }

        settings.push(...editables);
      }

      for (const setting of settings) {
        setting.originalValue = setting.value;
      }

      const mergingSettings = settings.map((setting) => ({
        key: setting.key,
        value: setting,
      }));

      const deviceSettings = this.deviceSettings.slice();
      // addAt = deviceSettings?.[0]?.value?.group ? 0 : 1;
      // deviceSettings.splice(addAt, 0, ...mergingSettings);
      deviceSettings.push(...mergingSettings);
      return Vue.observable(deviceSettings);
    },
    selectGroupNames() {
      const ret = Object.keys(this.settingsGroups).map(key => ({
        text: key.replace("Settings", "") || "General",
        value: key,
      }));
      if (this.availableMixins.length) {
        ret.push({
          value: 'extensions',
          text: 'Integrations and Extensions',
        })
      }
      return ret;
    },
    ScryptedInterface() {
      return ScryptedInterface;
    },
    showChips() {
      if (this.availableMixins.length)
        return true;
      return Object.keys(this.settingsGroups).length > 1;
    },
    settingsGroup() {
      return Object.entries(this.settingsGroups).find(sg => sg[0] === this.settingsGroupName)?.[1] || [];
    },
    settingsSubgroup() {
      if (!this.settingsSubgroups || this.settingsSubgroups.length === 1)
        return this.settingsGroup;
      const ret = this.settingsGroup.filter(sg => sg.value.subgroup === this.settingsSubgroupName || (!sg.value.subgroup && sg.value.group === this.settingsSubgroupName) || (!sg.value.subgroup && !sg.value.group && this.settingsSubgroupName === "General"));
      return ret;
    },
    settingsSubgroups() {
      const subgroups = new Set();
      for (const { value } of this.settingsGroup) {
        subgroups.add(value.subgroup || value.group || "General");
      }
      if (subgroups.size > 1)
        return [...subgroups.values()];
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
    dirty() {
      for (const { value } of this.settings) {
        if (JSON.stringify(value.value) !== JSON.stringify(value.originalValue))
          return true;
      }
      return false;
    }
  },
  methods: {
    onChange() { },
    createInputValue(v) {
      return {
        settings: this.settings.map((setting) => setting.value),
      };
    },
    needsDevice(setting) {
      return setting.value.type === 'clippath' || setting.value.type === 'button';
    },
    async refresh() {
      let settings;
      if (!this.device) {
        settings = this.value.settings;
      } else if (this.device.interfaces.includes(ScryptedInterface.Settings)) {
        settings = await this.rpc().getSettings();
      }
      else {
        settings = [];
      }

      for (const setting of settings) {
        setting.originalValue = setting.value;
      }

      this.deviceSettings = settings.map((setting) => ({
        key: setting.key,
        value: setting,
      }));
    },
    save() {
      for (const { value } of this.settings) {
        if (value.key === '__name' && value.value !== value.originalValue) {
          this.device.setName(value.value);
          continue;
        }
        if (value.key === '__type' && value.value !== value.originalValue) {
          this.device.setType(value.value);
          continue;
        }
        if (value.key === '__room' && value.value !== value.originalValue) {
          this.device.setRoom(value.value);
          continue;
        }
        if (JSON.stringify(value.value) !== JSON.stringify(value.originalValue)) {
          this.device.putSetting(value.key, value.value);
          // value.originalValue = value.value;
        }
      }
    },
  },
};
</script>
