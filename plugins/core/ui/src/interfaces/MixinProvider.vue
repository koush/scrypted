<template>
  <div>
    <v-card-text>{{ device.name }} can be enabled for these things.</v-card-text>
    <v-list-item-group>
      <v-list-item @click="
        mixin.enabled = !mixin.enabled;
        toggleMixin(mixin);
      " v-for="mixin in availableMixins" :key="mixin.id" inactive>
        <v-list-item-action>
          <v-checkbox dense @click.stop @change="toggleMixin(mixin)" v-model="mixin.enabled" color="primary">
          </v-checkbox>
        </v-list-item-action>

        <v-list-item-content>
          <v-list-item-subtitle>{{ mixin.name }}</v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-action>
          <v-btn x-small :to="getDeviceViewPath(mixin.id)">
            <v-icon x-small>{{ typeToIcon(mixin.type) }}</v-icon>
          </v-btn>
        </v-list-item-action>
      </v-list-item>
    </v-list-item-group>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DeviceGroup from "../common/DeviceTable.vue";
import { getMixinProviderAvailableDevices, setMixin } from "../common/mixin";
import { typeToIcon, getDeviceViewPath } from "../components/helpers";

export default {
  mixins: [RPCInterface],
  components: {
    DeviceGroup,
  },
  methods: {
    getDeviceViewPath,
    typeToIcon,
    async toggleMixin(mixin) {
      const device = this.$scrypted.systemManager.getDeviceById(mixin.id);
      await setMixin(
        this.$scrypted.systemManager,
        device,
        this.device.id,
        mixin.enabled
      );
    },
  },
  computed: {
    currentMixins() {
      const devices = this.$store.state.scrypted.devices
        .map((id) => this.$scrypted.systemManager.getDeviceById(id))
        .filter((device) => {
          return device.mixins?.includes(this.device.id);
        })
        .map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
          enabled: true,
        }));
      return devices;
    },
  },
  asyncComputed: {
    availableMixins: {
      default() {
        return this.currentMixins;
      },
      async get() {
        return getMixinProviderAvailableDevices(
          this.$scrypted.systemManager,
          this.device
        );
      },
    },
  },
};
</script>