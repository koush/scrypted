<template>
  <v-toolbar
    dense
    dark
    rounded
    :color="$vuetify.theme.dark ? undefined : 'deep-purple accent-3'"
    ><slot></slot></v-toolbar
  >
</template>
