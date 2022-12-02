<template>
  <v-autocomplete dense :small-chips="multiple" v-model="lazyValue" :items="devices" item-value="id" outlined :multiple="multiple"
    :label="title" :hint="description" persistent-hint @change="onInput">
    <template v-slot:append-outer>
      <slot name="append-outer"></slot>
    </template>
  </v-autocomplete>
</template>
<script>
import CustomValue from "./CustomValue.vue";

export default {
  mixins: [CustomValue],
  props: ["devices", "title", "description", "multiple"]
};
</script>