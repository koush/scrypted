<template>
    <div>
        <v-app v-if="launcherRoute" style="background-color: #6200EA;">
            <Login v-if="$store.state.isLoggedIn === false">
            </Login>
            <Reconnect v-else-if="$store.state.isConnected === false"></Reconnect>

            <div v-else style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                <div>
                    <v-card width="300px" class="elevation-24">
                        <v-card-title style="justify-content: center;" class="headline text-uppercase">Scrypted
                        </v-card-title>
                        <v-card-subtitle style="text-align: center;">{{ $store.state.version }}</v-card-subtitle>
                        <v-list class="transparent">
                            <v-list-item v-for="application in applications" :key="application.name"
                                @click="application.click">
                                <v-icon small>{{ application.icon }}</v-icon>
                                <v-list-item-title style="text-align: center;">{{ application.name }}
                                </v-list-item-title>
                            </v-list-item>
                            <v-list-item v-if="loading">
                                <v-progress-circular :size="16" color="primary" indeterminate></v-progress-circular>
                                <v-list-item-title style="text-align: center;">Loading...
                                </v-list-item-title>
                            </v-list-item>
                        </v-list>
                        <div style="justify-content: center; display: flex;">
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon href="https://github.com/koush/scrypted">
                                        <v-icon small>fab fa-github</v-icon>
                                    </v-btn>
                                </template>
                                <span>Github</span>
                            </v-tooltip>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon href="https://discord.gg/DcFzmBHYGq">
                                        <v-icon small>fab fa-discord</v-icon>
                                    </v-btn>
                                </template>
                                <span>Discord</span>
                            </v-tooltip>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon @click="logout">
                                        <v-icon small>fa-solid fa-arrow-right-from-bracket</v-icon>
                                    </v-btn>
                                </template>
                                <span>Log Out</span>
                            </v-tooltip>
                        </div>
                    </v-card>
                </div>
            </div>
        </v-app>
        <App v-else></App>
    </div>
</template>

<script>
import Login from "./Login.vue";
import App from "./App.vue";
import store from "./store";
import VueRouter from "vue-router";
import Reconnect from "./Reconnect.vue";
import { getAllDevices } from "./common/mixin";
import { ScryptedInterface } from "@scrypted/types";
import axios from 'axios';

let router = new VueRouter({
    routes: [
        {
            path: '/',
            name: 'Launcher',
        },
    ]
});

export default {
    name: "Launcher",
    components: {
        Login,
        App,
        Reconnect,
    },
    data() {
        return {
            loading: true,
            applications: [
                {
                    name: 'Management Console',
                    icon: 'fa-cog',
                    click: () => {
                        this.$router.push('/component/plugin');
                    }
                },
            ],
        }
    },
    mounted() {
        this.refreshApplications();
    },
    methods: {
        logout() {
            axios.get("/logout").then(() => window.location.reload());
        },
        refreshApplications() {
            if (!this.$store.state.isConnected || !this.$store.state.isLoggedIn || this.$route.name !== 'Launcher')
                return;

            this.loading = false;

            const { systemManager } = this.$scrypted;
            const applications = getAllDevices(systemManager).filter(device => device.interfaces.includes(ScryptedInterface.LauncherApplication));
            this.applications = applications.map(app => ({
                name: (app.applicationInfo && app.applicationInfo.name) || app.name,
                icon: app.applicationInfo && app.applicationInfo.icon,
                click: async () => {
                    const { endpointManager } = this.$scrypted;
                    window.location = `/endpoint/${app.id}/public/`;
                }
            }));
            if (!applications.length) {
                this.$router.push('/component/plugin');
                return;
            }

            this.applications.unshift(
                {
                    name: 'Management Console',
                    icon: 'fa-cog',
                    click: () => {
                        this.$router.push('/component/plugin');
                    }
                }
            )
        }
    },
    watch: {
        async "$store.state.isLoggedIn"(value) {
            this.refreshApplications();
        },
        async "$store.state.isConnected"(value) {
            this.refreshApplications();
        },
    },
    computed: {
        launcherRoute() {
            return this.$route.name === 'Launcher';
        }
    },
    store,
    router,
}
</script>
