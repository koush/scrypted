<template>
  <v-form>
    <v-container>
      <v-layout>
        <v-flex xs12>
          <v-text-field outlined v-model="lazyValue.name" @input="onInput" persistent-hint label="Recipient Name" hint='e.g. "Me" or "Alice" or "Bob"'></v-text-field>
        </v-flex>
      </v-layout>
    </v-container>
  </v-form>
</template>
<script>
import CustomValue from "../../common/CustomValue.vue";

export default {
  mixins: [CustomValue]
};
</script>