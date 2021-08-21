<template>
  <v-form>
    <v-container>
      <v-layout>
        <v-flex xs12>
          <v-text-field ref="inviteTextField" label="Invite Link" xs10 readonly outlined :value="value.invite">
            <template v-slot:prepend-inner>
              <v-tooltip bottom>
                <template v-slot:activator="{ on }">
                  <v-btn text x-small v-clipboard:copy="value.invite">
                    <v-icon v-on="on">file_copy</v-icon>
                  </v-btn>
                </template>
                Copy Invite Link
              </v-tooltip>
            </template>
          </v-text-field>
        </v-flex>
      </v-layout>
    </v-container>
  </v-form>
</template>
<script>
export default {
  props: ["value"],
  methods: {
      copy() {
        this.$refs.inviteTextField.$el.select();
        document.execCommand('copy');
      }
  }
};
</script>