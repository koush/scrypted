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
                        <v-card-subtitle v-if="$store.state.loginHostname"
                            style="text-align: center; font-weight: 300; font-size: .75rem !important; font-family: Quicksand, sans-serif!important;"
                            class="text-subtitle-2 text-uppercase">
                            {{ $store.state.version }}
                            <br />
                            Logged into: {{ $store.state.loginHostname
                            }}
                        </v-card-subtitle>
                        <v-card-subtitle v-else style="text-align: center;">{{ $store.state.version }}</v-card-subtitle>
                        <v-list class="transparent">
                            <v-list-item v-for="application in applications" :key="application.name" :to="application.to"
                                :href="application.href">
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
                        <v-card-actions>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon href="https://twitter.com/scryptedapp/">
                                        <v-icon small>fab fa-twitter</v-icon>
                                    </v-btn>
                                </template>
                                <span>Twitter</span>
                            </v-tooltip>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon href="https://www.reddit.com/r/Scrypted/">
                                        <v-icon small>fab fa-reddit</v-icon>
                                    </v-btn>
                                </template>
                                <span>Reddit</span>
                            </v-tooltip>
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
                            <v-spacer></v-spacer>
                            <v-tooltip bottom>
                                <template v-slot:activator="{ on }">
                                    <v-btn v-on="on" icon @click="logout">
                                        <v-icon small>fa-solid fa-arrow-right-from-bracket</v-icon>
                                    </v-btn>
                                </template>
                                <span>Log Out</span>
                            </v-tooltip>
                        </v-card-actions>
                    </v-card>
                    <v-card width="300px" class="elevation-24 mt-4" v-if="showNvr" dark>
                        <v-card-title style="justify-content: center;" class="headline text-uppercase">Support Scrypted
                        </v-card-title>
                        <v-card-subtitle style="justify-content: center; text-align: center;"
                            class="headline text-uppercase">Get Scrypted NVR</v-card-subtitle>
                        <v-list style="font-size: .85rem">

                            <v-list-item>
                                <v-list-item-icon class="mr-2">
                                    <v-icon small>fa fa-timeline</v-icon>
                                </v-list-item-icon>
                                24/7 recording with smart detections.
                            </v-list-item>

                            <v-list-item>
                                <v-list-item-icon class="mr-2">
                                    <v-icon small>fa-solid fa-bolt-lightning</v-icon>
                                </v-list-item-icon>
                                Adaptive bitrate streaming for HomeKit, Google Home, Alexa, and Chromecast.
                            </v-list-item>

                            <v-list-item>
                                <v-list-item-icon class="mr-2">
                                    <v-icon small>fa-solid fa-video-camera</v-icon>
                                </v-list-item-icon>
                                Camera Dashboard and live view grid. 4K camera support.
                            </v-list-item>

                            <v-list-item>
                                <v-list-item-icon class="mr-2">
                                    <v-icon small>fa fa-cloud</v-icon>
                                </v-list-item-icon>
                                Cloud access from browsers or apps.
                            </v-list-item>
                        </v-list>
                        <div style="width: 100%; display: flex; justify-content: center;">
                            <v-btn style="justify-self: center;" href="https://demo.scrypted.app/#/demo">View Demo
                            </v-btn>
                            <v-btn style="justify-self: center;" :to="nvrInstall">Install
                            </v-btn>
                        </div>
                    </v-card>
                </div>
            </div>
        </v-app>
        <App v-else></App>
    </div>
</template>

<script>
import { ScryptedInterface } from "@scrypted/types";
import axios from 'axios';
import VueRouter from "vue-router";
import { combineBaseUrl, getCurrentBaseUrl, logoutScryptedClient } from '../../../../packages/client/src/index';
import App from "./App.vue";
import Login from "./Login.vue";
import Reconnect from "./Reconnect.vue";
import { getAllDevices } from "./common/mixin";
import store from "./store";

const nvrInstall = '/component/plugin/install/@scrypted/nvr'

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
            nvrInstall,
            loading: true,
            showNvr: false,
            applications: [
                {
                    name: 'Management Console',
                    icon: 'fa-cog',
                    to: '/component/plugin',
                },
            ],
        }
    },
    mounted() {
        this.refreshApplications();
    },
    methods: {
        async logout() {
            await logoutScryptedClient(getCurrentBaseUrl());
            window.location.reload();
        },
        refreshApplications() {
            if (!this.$store.state.isConnected || !this.$store.state.isLoggedIn || this.$route.name !== 'Launcher')
                return;

            this.loading = false;

            const { systemManager } = this.$scrypted;
            const applications = getAllDevices(systemManager).filter(device => device.interfaces.includes(ScryptedInterface.LauncherApplication));
            this.applications = applications.map(app => {
                const appId = app.interfaces.includes(ScryptedInterface.ScryptedPlugin) ? app.pluginId : app.id;
                const baseUrl = getCurrentBaseUrl();
                const defaultUrl = combineBaseUrl(baseUrl, `endpoint/${appId}/public/`);

                const ret = {
                    name: (app.applicationInfo && app.applicationInfo.name) || app.name,
                    icon: app.applicationInfo && app.applicationInfo.icon,
                    href: (app.applicationInfo && app.applicationInfo.href) || defaultUrl,
                };
                return ret;
            });
            // if (!applications.length) {
            //     this.$router.push('/component/plugin');
            //     return;
            // }

            this.applications.unshift(
                {
                    name: 'Management Console',
                    icon: 'fa-cog',
                    to: '/component/plugin',
                },
            )

            this.showNvr = !systemManager.getDeviceByName('@scrypted/nvr');
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
