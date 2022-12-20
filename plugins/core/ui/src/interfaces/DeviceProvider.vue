<template>
  <v-flex xs12>
    <v-card-actions
      v-if="
        device.interfaces.includes('DeviceCreator') ||
        device.interfaces.includes('DeviceDiscovery')
      "
    >
      <v-dialog max-width="600px" v-model="showCreateDeviceSettings">
        <Settings v-model="createDeviceSettings" :noTitle="true" class="pa-2">
          <template v-slot:append>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn text color="primary" @click="createDevice">Create</v-btn>
            </v-card-actions>
          </template>
        </Settings>
      </v-dialog>
      <v-btn
        v-if="device.interfaces.includes('DeviceCreator')"
        text
        color="primary"
        @click="openDeviceCreationDialog"
        >Add New</v-btn
      >
      <!-- <v-btn
        v-if="device.interfaces.includes('DeviceDiscovery')"
        text
        color="primary"
        >Discover Devices</v-btn
      > -->
    </v-card-actions>

    <v-card-text>These things were created by {{ device.name }}.</v-card-text>
    <v-text-field
      v-if="managedDevices.devices.length > 10"
      v-model="search"
      append-icon="search"
      label="Search"
      single-line
      hide-details
    ></v-text-field>
    <v-data-table
      v-if="managedDevices.devices.length > 10"
      :headers="headers"
      :items="managedDevices.devices"
      :items-per-page="10"
      :search="search"
    >
      <template v-slot:[`item.icon`]="{ item }">
        <v-icon x-small color="grey">
          {{ typeToIcon(item.type) }}
        </v-icon>
      </template>
      <template v-slot:[`item.name`]="{ item }">
        <a link :href="'#' + getDeviceViewPath(item.id)">{{ item.name }}</a>
      </template>
    </v-data-table>

    <DeviceGroup v-else :deviceGroup="managedDevices"></DeviceGroup>
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
      showCreateDeviceSettings: false,
      showCreateDevice: false,
      createDeviceSettings: null,
      search: "",
    };
  },
  components: {
    Settings,
    DeviceGroup,
  },
  methods: {
    typeToIcon,
    getDeviceViewPath,

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
        this.showCreateDeviceSettings = true;
      }
    },
  },
  computed: {
    headers() {
      var ret = [];
      ret.push({
        width: 40,
        text: "",
        align: "left",
        sortable: false,
        value: "icon",
      });

      ret.push({
        text: "Name",
        align: "left",
        sortable: true,
        value: "name",
      });

      ret.push({
        text: "Type",
        align: "left",
        sortable: true,
        value: "type",
      });
      return ret;
    },
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
