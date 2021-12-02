<template>
  <v-flex xs12>
    <v-dialog
      v-if="createDeviceSettings"
      :value="true"
      max-width="600px"
      persistent
    >
      <Settings
        v-model="createDeviceSettings"
        :noTitle="true"
        class="pa-2"
      >
        <template v-slot:append>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn text color="primary" @click="createDevice">Create</v-btn>
          </v-card-actions>
        </template>
      </Settings>
    </v-dialog>
    <v-card-actions
      v-if="
        device.interfaces.includes('DeviceCreator') ||
        device.interfaces.includes('DeviceDiscovery')
      "
    >
      <v-btn
        v-if="device.interfaces.includes('DeviceCreator')"
        text
        color="primary"
        @click="openDeviceCreationDialog"
        >Add Device</v-btn
      >
      <v-btn
        v-if="device.interfaces.includes('DeviceDiscovery')"
        text
        color="primary"
        >Discover Devices</v-btn
      >
    </v-card-actions>
    <v-card-text>These things were created by {{ device.name }}.</v-card-text>
    <DeviceGroup :deviceGroup="managedDevices"></DeviceGroup>
  </v-flex>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Settings from "./Settings.vue";
import DeviceGroup from "../common/DeviceTable.vue";
import { typeToIcon, getDeviceViewPath } from "../components/helpers";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      junk: {},
      showCreateDevice: false,
      createDeviceSettings: null,
    };
  },
  components: {
    Settings,
    DeviceGroup,
  },
  methods: {
    async createDevice() {
      const settings = {};
      for (const setting of this.createDeviceSettings.settings) {
        settings[setting.key] = setting.value;
      }
      const id = await this.device.createDevice(settings);
      this.$router.push(getDeviceViewPath(id));
    },
    async openDeviceCreationDialog() {
      const settings = await this.device.getCreateDeviceSettings();
      if (settings) {
        for (const setting of settings) {
          setting.value = setting.value || null;
        }

        this.createDeviceSettings = {
          settings,
        };
      }
    },
  },
  computed: {
    managedDevices() {
      const devices = this.$store.state.scrypted.devices
        .filter(
          (id) =>
            this.$store.state.systemState[id].providerId.value ===
              this.device.id && this.device.id !== id
        )
        .map((id) => ({
          id,
          name: this.$store.state.systemState[id].name.value,
          type: this.$store.state.systemState[id].type.value,
        }));

      return {
        devices,
      };
    },
  },
};
</script>
