<template>
  <v-flex xs12 md8 lg6>
    <v-card raised style="margin-bottom: 60px">
      <v-card-title
        class="orange-gradient subtitle-1 text--white font-weight-light"
      >
        <font-awesome-icon size="sm" icon="bolt" />
        <span class="title font-weight-light"
          >&nbsp;&nbsp;Scrypted Plugins</span
        >
      </v-card-title>

      <v-card-text
        >Integrate your existing smart home devices and services.</v-card-text
      >
      <v-container>
        <v-layout>
          <v-flex>
            <v-text-field
              v-model="search"
              placeholder="Try searching for 'Hue' or 'Lifx'"
              append-icon="search"
              label="Search"
              single-line
              hide-details
              @input="doSearch"
            ></v-text-field>
          </v-flex>
        </v-layout>
      </v-container>
    </v-card>

    <v-flex xs12>
      <v-card class="mb-2" v-for="result in results" :key="result.package.name">
        <v-card-title class="title">{{ result.package.name }}</v-card-title>
        <v-card-text class="subtitle-2">{{
          result.package.description
        }}</v-card-text>
        <v-container class="ml-2">
          <v-layout align-center>
            <img :src="avatar(result.package.publisher.email)" class="mx-1" />
            <span>
              <b>{{ result.package.publisher.username }}</b>
            </span>
            <span class="mx-1">{{
              " published " +
              result.package.version +
              " • " +
              new Date(result.package.date).toDateString()
            }}</span>
          </v-layout>
        </v-container>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            color="info"
            outlined
            @click="openLink(result.package.links.npm)"
            >View on npm</v-btn
          >
          <v-btn color="success" @click="install(result.package.name)"
            >Install</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-flex>
  </v-flex>
</template>


<script>
import debounce from "lodash/debounce";
import md5 from "md5";
import axios from "axios";
import { getComponentWebPath, getDeviceViewPath } from "../helpers";
import { installNpm } from "./plugin";

export default {
  data: function () {
    return {
      search: "",
      results: [],
    };
  },
  mounted: function () {
    this.doSearch();
  },
  methods: {
    install(packageName) {
      installNpm(packageName).then((id) =>
        this.$router.push(getDeviceViewPath(id))
      );
    },
    openLink(link) {
      window.open(link, "npm");
    },
    avatar(email) {
      return `https://www.gravatar.com/avatar/${md5(email)}?s=28`;
    },
    doSearch: debounce(function () {
      axios
        .get(
          `${getComponentWebPath("script")}/search?text=keywords:scrypted+${
            this.search
          }`
        )
        .then((response) => {
          this.results = response.data.objects;
        });
    }, 500),
  },
};
</script>

<style>
.package-title {
  color: inherit;
}
</style>
