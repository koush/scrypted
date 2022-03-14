<template>
  <v-toolbar
    dense
    dark
    rounded
    :color="color || ($vuetify.theme.dark ? undefined : colors.blueGrey.darken1)"
    ><slot></slot></v-toolbar
  >
</template>
<script>
import colors from "vuetify/es5/util/colors";

export default {
    props: ['color'],

    data() {
        return {
            colors,
        }
    }
}
</script>
