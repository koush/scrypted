<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >Z-Wave Home Id: {{ $route.params.homeId }}</v-card-title>

          <v-card-text>{{ settings.description }}</v-card-text>
          <v-simple-table>
            <thead>
              <tr>
                <th class="text-xs-left">Node Id</th>
                <th class="text-xs-left">Name</th>
              </tr>
            </thead>
            <tbody class="body-2 font-weight-light">
              <tr v-for="node in settings.nodes" :key="node.id">
                <td>{{ node.id }}</td>
                <td><router-link append :to="node.id.toString()">{{ node.name }}</router-link></td>
              </tr>
            </tbody>
          </v-simple-table>
        </v-card>
      </v-flex>
    </v-flex>
  </v-layout>
</template>
<script>
import { getComponentWebPath } from "../helpers";
import axios from "axios";

export default {
  data() {
    return {
      loading: true,
      settings: {}
    };
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath("zwave");
    }
  },
  methods: {
    getComponentWebPath,
    refresh() {
      axios
        .get(`${this.componentWebPath}/view/${this.$route.params.homeId}`)
        .then(response => {
          this.$data.settings = response.data;
          this.loading = false;
        });
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>
