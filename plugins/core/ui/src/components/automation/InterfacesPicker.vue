<template>
  <Grower v-model="lazyValue" :empty="unassigned" @input="onInput">
    <template v-slot:default="slotProps">
      <InterfacePicker :testDevice="testDevice" :interfaces="interfaces" v-model="slotProps.item" @input="slotProps.onInput"></InterfacePicker>
    </template>
  </Grower>
</template>

<script>
import InterfacePicker from "./InterfacePicker.vue";
import CustomValue from "../../common/CustomValue.vue";
import Grower from "../../common/Grower.vue";

export default {
  props: {
    name: String,
    interfaces: Array,
    testDevice: Object,
  },
  mixins: [CustomValue],
  components: {
    Grower,
    InterfacePicker
  },
  computed: {
    unassigned() {
      return {
        // unique per interfaces array
        id: "unassigned",
        model: {}
      };
    }
  },
  methods: {
    createInputValue() {
      return this.lazyValue.slice().filter(e => e.id != "unassigned");
    }
  }
};
</script>
