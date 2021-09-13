<template>
    <v-layout row>
  <v-flex xs5 class="pr-0 pt-1 pb-1">
      <v-text-field
      dense
        ref="variableName"
        outlined
        label="Storage Key"
        xs6
        v-model="lazyValue.key"
        @input="onInput"
        hide-details
      ></v-text-field>
  </v-flex>
  <v-flex xs7 class="pl-0 pt-1 pb-1">

      <v-text-field
      dense
        ref="variableValue"
        outlined
        label="Storage Value"
        xs6
        v-model="lazyValue.value"
        @input="onInput"
        hide-details
      ></v-text-field>
  </v-flex>
    </v-layout>
</template>
<script>
import CustomValue from "./CustomValue.vue";

export default {
  name: "StorageEntry",
  mixins: [
    CustomValue
  ],
};
</script>