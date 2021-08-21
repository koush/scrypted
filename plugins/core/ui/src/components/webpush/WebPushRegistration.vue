<template>
  <v-flex>
    <v-card raised class="header-card" style="margin-bottom: 60px">
      <v-card-title
        class="green-gradient subtitle-1 text--white  font-weight-light"
      >
        <font-awesome-icon size="sm" icon="bell" />
        <span class="title font-weight-light">&nbsp;&nbsp;Browser Subscription</span>
      </v-card-title>
      <v-form>
        <v-container>
          <v-layout>
            <v-flex xs12>
              <v-text-field
                outlined
                label="Endpoint"
                readonly
                :value="deviceProps.registration.endpoint"
              ></v-text-field>
            </v-flex>
          </v-layout>
        </v-container>
      </v-form>
    </v-card>
  </v-flex>
</template>
<script>
export default {
  props: ["id", "name", "deviceProps", "value"]
};
</script>