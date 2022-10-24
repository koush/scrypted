<template>
  <div>
    <div v-for="(item, index) in lazyValue" :key="index">
      <slot v-bind:item="item" v-bind:onInput="setIndex(index)"></slot>
    </div>

    <v-card-actions>
      <v-spacer v-if="!left"></v-spacer>
      <v-btn small @click="add">{{ addButton }}</v-btn>
      <v-btn small v-if="saveButton" @click="$emit('save')">{{ saveButton }}</v-btn>
    </v-card-actions>
    <slot name="append-outer"></slot>
  </div>
</template>
<script>
import cloneDeep from "lodash/cloneDeep";
import CustomValue from "./CustomValue.vue";

export default {
  props: {
    left: false,
    empty: undefined,
    addButton: {
      default: "Add",
      type: String,
    },
    saveButton: {
      default: undefined,
      type: String,
    },
  },
  mixins: [CustomValue],
  methods: {
    setIndex(index) {
      return (entry) => {
        this.lazyValue[index] = entry;
        this.onInput();
      };
    },
    add() {
      this.lazyValue.push(cloneDeep(this.empty));
      this.onInput();
    },
  },
};
</script>
