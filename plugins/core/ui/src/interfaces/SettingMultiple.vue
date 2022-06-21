<template>
  <Grower
    v-model="lazyValue"
    :empty="empty"
    :saveButton="dirty ? 'Save ' + value.title : undefined"
    @save="save"
  >
    <template v-slot:default="slotProps">
      <Setting v-model="slotProps.item" @input="slotProps.onInput"></Setting>
    </template>
  </Grower>
</template>
<script>
import Grower from "../common/Grower.vue";
import CustomValue from "../common/CustomValue.vue";
import Setting from "./Setting.vue";
import cloneDeep from "lodash/cloneDeep";

export default {
  props: ["value", "device"],
  mixins: [CustomValue, Setting],
  components: {
    Setting,
    Grower,
  },
  computed: {
    dirty() {
      return JSON.stringify(this.value) !== JSON.stringify(this.createInputValue());
    },
    empty() {
      const empty = cloneDeep(this.value);
      empty.value = undefined;
      return empty;
    },
  },
  methods: {
    save() {
      let { key, value } = this.createInputValue();
      value = value.filter(v => v !== undefined && v !== '');
      this.rpc().putSetting(key, value);
      this.onInput();
    },
    createLazyValue() {
      const value =
        this.value.value?.constructor === Array ? this.value.value : [];
      if (!value.length) value.push(undefined);
      return value.map((v) => {
        const ret = cloneDeep(this.value);
        ret.value = v;
        return ret;
      });
    },
    createInputValue() {
      const inputValue = cloneDeep(this.value);
      inputValue.value = this.lazyValue.map((i) => i.value);
      return inputValue;
    },
  },
};
</script>
