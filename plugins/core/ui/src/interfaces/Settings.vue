<template>
  <div>
    <v-card
      v-for="([key, settingsGroup], index) of Object.entries(settingsGroups)"
      :class="
        index === Object.entries(settingsGroups).length - 1 ? undefined : 'mb-6'
      "
      :key="key"
    >
      <v-card-title
        class="red-gradient white--text subtitle-1 font-weight-light"
        >{{ key }}</v-card-title
      >
      <v-flex xs12>
        <Setting
          :device="device"
          v-for="setting in settingsGroup"
          :key="setting.key"
          v-model="setting.value"
        ></Setting>
      </v-flex>
    </v-card>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Setting from "./Setting.vue";

export default {
  components: {
    Setting,
  },
  mixins: [RPCInterface],
  data() {
    return {
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
