<template>
  <div>
    <v-card>
      <v-card-title class="subtitle-1 font-weight-light">Settings</v-card-title>
      <v-flex xs12 v-if="showChips" class="pt-0">
        <v-chip-group
          mandatory
          active-class="deep-purple accent-4 white--text"
          column
          v-model="settingsIndex"
        >
          <v-chip
            small
            v-for="([key], index) of Object.entries(settingsGroups)"
            :key="index"
          >
            {{ key.replace("Settings", "") || "General" }}
          </v-chip>
        </v-chip-group>
      </v-flex>

      <v-divider v-if="showChips"></v-divider>

      <v-flex xs12>
        <div v-for="setting in settingsGroup" :key="setting.key">
          <Setting
            v-if="setting.value.choices || setting.value.type === 'device' || !setting.value.multiple"
            :device="device"
            v-model="setting.value"
          ></Setting>
          <SettingMultiple v-else v-model="setting.value" :device="device">
          </SettingMultiple>
        </div>
      </v-flex>
    </v-card>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Setting from "./Setting.vue";
import SettingMultiple from "./SettingMultiple.vue";

export default {
  components: {
    Setting,
    SettingMultiple,
  },
  mixins: [RPCInterface],
  data() {
    return {
      settingsIndex: 0,
      settings: [],
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
    showChips() {
      return Object.keys(this.settingsGroups).length > 1;
    },
    settingsGroup() {
      const check = Object.entries(this.settingsGroups)[this.settingsIndex];
      if (!check) return [];
      return check[1];
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
    async refresh() {
      const blub = this.rpc().getSettings();
      var settings = await blub;
      this.settings = this.settings = settings.map((setting) => ({
        key: setting.key,
        value: setting,
      }));
    },
  },
};
</script>
