<template>
  <div>
    <v-checkbox
      v-if="lazyValue.type && lazyValue.type.toLowerCase() === 'boolean'"
      dense
      :readonly="lazyValue.readonly"
      v-model="booleanValue"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      :placeholder="lazyValue.placeholder"
      persistent-hint
      @change="save"
      :class="lazyValue.description ? 'mb-2' : ''"
    ></v-checkbox>
    <div v-if="lazyValue.type === 'button'" @click="save">
      <v-btn small block> {{ lazyValue.title }} </v-btn>
      <span v-if="lazyValue.description" class="caption pl-1">{{ lazyValue.description }}</span>
    </div>
    <v-combobox
      v-else-if="lazyValue.choices && lazyValue.combobox"
      dense
      :readonly="lazyValue.readonly"
      :items="lazyValue.choices"
      :multiple="lazyValue.multiple"
      :small-chips="lazyValue.multiple"
      v-model="lazyValue.value"
      outlined
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :placeholder="lazyValue.placeholder"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-combobox>
    <v-select
      v-else-if="lazyValue.choices"
      dense
      :readonly="lazyValue.readonly"
      :items="lazyValue.choices"
      :multiple="lazyValue.multiple"
      :small-chips="lazyValue.multiple"
      v-model="lazyValue.value"
      outlined
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :placeholder="lazyValue.placeholder"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-select>
    <DevicePicker
      v-else-if="lazyValue.type === 'device'"
      v-model="lazyValue.value"
      :multiple="lazyValue.multiple"
      :devices="devices"
      :title="lazyValue.title"
      :description="lazyValue.description"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </DevicePicker>
    <v-text-field
      v-else
      dense
      :readonly="lazyValue.readonly"
      outlined
      v-model="lazyValue.value"
      :placeholder="lazyValue.placeholder"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :type="lazyValue.type === 'password' ? 'password' : undefined"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          text
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DevicePicker from "../common/DevicePicker.vue";
import Grower from "../common/Grower.vue";
import cloneDeep from "lodash/cloneDeep";

export default {
  mixins: [RPCInterface],
  components: {
    DevicePicker,
    Grower,
  },
  watch: {
    dirty() {
      if (this.device) return;
      this.onInput();
    },
  },
  computed: {
    booleanValue: {
      get() {
        return (
          this.lazyValue.value &&
          this.lazyValue.value.toString().toLowerCase() === "true"
        );
      },
      set(val) {
        this.lazyValue.value = val.toString();
      },
    },
    dirty() {
      return (
        JSON.stringify(this.lazyValue.value) !==
        JSON.stringify(this.value.value)
      );
    },
    devices() {
      var expression;
      try {
        expression = this.lazyValue.deviceFilter || "true;";
        // var interfaces = this.$scrypted.systemManager.getDeviceById(id).interfaces.map(iface => `var ${iface} = true`);
      } catch (e) {
        expression = "true;";
      }
      var ret = this.$store.state.scrypted.devices
        .map((id) => this.$scrypted.systemManager.getDeviceById(id))
        .filter((device) => {
          try {
            return eval(
              `(function() { var interfaces = ${JSON.stringify(
                device.interfaces
              )}; var type='${device.type}'; return ${expression} })`
            )();
          } catch (e) {
            return true;
          }
        })
        .map((device) => ({
          id: device.id,
          text: device.name,
        }));
      if (!this.lazyValue.multiple) {
        ret.splice(0, 0, {
          id: null,
          text: this.lazyValue.placeholder || "Select a Device",
        });
      }
      return ret;
    },
  },
  methods: {
    onChange() {},
    createLazyValue() {
      var type = this.value.type || "";
      if (type.indexOf("[]") == -1) {
        return cloneDeep(this.value);
      }

      var ret = cloneDeep(this.value);
      ret.value = JSON.parse(ret.value);
      return ret;
    },
    createInputValue() {
      var type = this.lazyValue.type || "";
      if (type.indexOf("[]") == -1) {
        return this.lazyValue;
      }

      var ret = cloneDeep(this.lazyValue);
      ret.value = JSON.stringify(ret.value.filter((id) => id));
      return ret;
    },
    save() {
      this.rpc().putSetting(this.lazyValue.key, this.createInputValue().value);
      this.onInput();
    },
  },
};
</script>
<style scoped>
.shift-up {
  margin-top: -8px;
}
</style>