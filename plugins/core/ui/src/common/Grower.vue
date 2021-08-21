<template>
  <div>
    <div v-for="(item, index) in lazyValue" :key="index">
      <slot v-bind:item="item" v-bind:onInput="setIndex(index)"></slot>
    </div>

    <v-btn @click="add">{{ addButton }}</v-btn>
    <slot name="append-outer"></slot>
  </div>
</template>
<script>
import cloneDeep from "lodash.clonedeep";
import CustomValue from "./CustomValue.vue";

export default {
  props: {
    empty: undefined,
    addButton: {
      default: "Add",
      type: String
    }
  },
  mixins: [CustomValue],
  methods: {
    setIndex(index) {
      return entry => {
          this.lazyValue[index] = entry;
          this.onInput();
      };
    },
    add() {
      this.lazyValue.push(cloneDeep(this.empty));
    }
  }
};
</script>
