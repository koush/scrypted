<template>
  <Select2
    :label="name"
    v-model="lazyValue"
    :options="mappedInterfaces"
    :multiple="true"
    @input="onInput"
    :hint="`<a href='https://developer.scrypted.app/#interfaces'>Interfaces</a>`"
  ></Select2>
</template>
<script>
import Select2 from "../../common/Select2.vue";
import CustomValue from "../../common/CustomValue.vue";

export default {
  props: {
    name: String,
    value: Array,
    filter: Function,
  },
  mixins: [CustomValue],
  components: {
    Select2,
  },
  methods: {
    createLazyValue() {
      var mapped = this.mapThem();
      return this.value
        .map((iface) => mapped.find((e) => e.id == iface))
        .filter((e) => e != null);
    },
    createInputValue() {
      return this.lazyValue.map((iface) => iface.id);
    },
    mapThem: function () {
      const ret = [];
      const filter = this.filter || (() => true);
      for (const id of Object.keys(
        this.$scrypted.systemManager.getSystemState()
      )) {
        const device = this.$scrypted.systemManager.getDeviceById(id);
        ret.push(
          device.interfaces.map((iface) => ({
            id: `${device.id}#${iface}`,
            text: `${device.name} (${iface})`,
          })).filter(filter)
        );
      }

      return ret.flat();
    },
  },
  computed: {
    mappedInterfaces: {
      get: function () {
        return this.mapThem();
      },
    },
  },
};
</script>