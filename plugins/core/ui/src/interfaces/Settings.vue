<template>
  <v-card>
    <CardTitle v-if="!noTitle">Settings</CardTitle>
    <v-flex xs12 v-if="showChips" class="pt-0">
      <v-chip-group mandatory active-class="deep-purple accent-4 white--text" column v-model="settingsGroupName">
        <v-chip small :value="key" v-for="[key] of Object.entries(settingsGroups)" :key="key">
          {{ key.replace("Settings", "") || "General" }}
        </v-chip>
        <v-chip small value="extensions" v-if="availableMixins.length">
          Integrations and Extensions
        </v-chip>
      </v-chip-group>
    </v-flex>

    <v-divider v-if="showChips"></v-divider>

    <v-flex xs12 v-if="settingsGroupName !== 'extensions' || !showChips">
      <div v-for="setting in settingsGroup" :key="setting.key">
        <Setting v-if="
        setting.value.choices ||
        setting.value.type === 'device' ||
        setting.value.type === 'interface' ||
        !setting.value.multiple" v-model="setting.value" @input="onInput"></Setting>
        <SettingMultiple v-else v-model="setting.value" @input="onInput">
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
import RPCInterface from "./RPCInterface.vue";
import Setting from "./Setting.vue";
import SettingMultiple from "./SettingMultiple.vue";
import CardTitle from "../components/CardTitle.vue";
import AvailableMixins from "../components/AvailableMixins.vue";
import Mixin from "../components/Mixin.vue";
import { ScryptedInterface } from "@scrypted/types";
import { hasFixedPhysicalLocation, inferTypesFromInterfaces } from "../components/helpers";

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
      usingDefaultSettingsGroupName: true,
      settingsGroupName: undefined,
      settings: [],
    };
  },
  watch: {
    device() {
      this.refresh();
    },
    availableMixins() {
      this.updateSettingsGroupName();
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
      if (this.availableMixins.length)
        return true;
      return Object.keys(this.settingsGroups).length > 1;
    },
    settingsGroup() {
      return Object.entries(this.settingsGroups).find(sg => sg[0] === this.settingsGroupName)?.[1] || [];
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
      if (this.device && !this.device.interfaces.includes(ScryptedInterface.ScryptedPlugin)) {
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
        if (hasFixedPhysicalLocation(this.device.type, this.device.interfaces)) {
          const existingRooms = this.$store.state.scrypted.devices
            .map(
              (device) => this.$scrypted.systemManager.getDeviceById(device).room
            )
            .filter((room) => room);

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

        settings.splice(settings?.[0]?.group ? 0 : 1, 0, ...editables);
      }

      for (const setting of settings) {
        setting.originalValue = setting.value;
      }
      this.settings = settings.map((setting) => ({
        key: setting.key,
        value: setting,
      }));

      this.updateSettingsGroupName();
    },
    save() {
      for (const { value } of this.settings) {
        if (value.key === '__name') {
          this.device.setName(value.value);
          continue;
        }
        if (value.key === '__type') {
          this.device.setType(value.value);
          continue;
        }
        if (value.key === '__room') {
          this.device.setRoom(value.value);
          continue;
        }
        if (JSON.stringify(value.value) !== JSON.stringify(value.originalValue)) {
          this.device.putSetting(value.key, value.value);
          // value.originalValue = value.value;
        }
      }
    },
    updateSettingsGroupName() {
      if (!this.usingDefaultSettingsGroupName) {
        // make sure the selected settings tab still exists
        if (this.settingsGroupName === 'extensions')
          this.usingDefaultSettingsGroupName = !this.availableMixins.length;
        else if (!this.settingsGroups[this.settingsGroupName])
          this.usingDefaultSettingsGroupName = true;
      }
      if (this.usingDefaultSettingsGroupName) {
        this.usingDefaultSettingsGroupName = false;
        this.settingsGroupName = Object.keys(this.settingsGroups)?.[0] || 'extensions';
      }
    }
  },
};
</script>
