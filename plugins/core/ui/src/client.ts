import Vue from "vue";
import {connectScryptedClient} from '../../../../packages/client/src/index';
import axios from 'axios';
import store from './store';

function hasValue(state: any, property: string) {
    return state[property] && state[property].value;
}

function isValidDevice(id: string) {
    const state = store.state.systemState[id];
    for (const property of [
        "name",
        "interfaces",
        "type"
    ]) {
        if (!hasValue(state, property)) {
            return false;
        }
    }
    return true;
}

Vue.use(Vue => {
    Vue.prototype.$connectScrypted = () => {
        const clientPromise = connectScryptedClient({
            pluginId: '@scrypted/core',
        })
        .then(async (scrypted) => {
            // todo: fix this.
            // since moving the connection out of the @scrypted/core and
            // directly onto the server, userStorage no longer exists.
            if (!scrypted.userStorage)
                scrypted.userStorage = localStorage;
            return scrypted;
        });

        store.commit("setHasLogin", undefined);
        store.commit("setIsLoggedIn", undefined);
        store.commit("setUsername", undefined);
        store.commit("setIsConnected", undefined);
        store.commit("setIsLoggedIntoCloud", undefined);

        return axios
            .get("/login", {
                headers: {
                    Accept: "application/json"
                }
            })
            .then(response => {
                if (!response.data.expiration) {
                    if (response.data.redirect) {
                        store.commit("setIsLoggedIntoCloud", false);
                    }
                    store.commit("setHasLogin", response.data.hasLogin);
                    throw new Error("Login failed.");
                }
                store.commit("setHasLogin", true);
                store.commit("setIsLoggedIn", true);
                store.commit("setUsername", response.data.username);
                setTimeout(() => {
                    store.commit("setIsLoggedIn", false);
                }, response.data.expiration);
                return clientPromise;
            })
            .catch(e => {
                store.commit("setIsLoggedIn", false);
                throw e;
            })
            .then(scrypted => {
                Vue.prototype.$scrypted = scrypted;
                // system state is returned as a reference and updated by the scrypted client, so passing it to vue allows direct model updates.
                // this is not the same behavior as on android. fix?
                const systemState = scrypted.systemManager.getSystemState();
                store.commit("setSystemState", systemState);
                store.commit("setDevices", Object.keys(systemState));
                store.commit("setIsConnected", true);
                store.commit("setVersion", scrypted.version);

                scrypted.onClose = () => {
                    store.commit("setIsConnected", false);
                };

                scrypted.systemManager.listen(
                    async (eventSource, eventDetails, eventData) => {
                        if (eventSource) {
                            const id = eventSource.id;

                            // ensure the property is reactive
                            if (eventDetails.eventInterface === "ScryptedDevice") {
                                Vue.set(systemState, id, systemState[id]);
                                if (isValidDevice(id)) {
                                    store.commit("addDevice", id);
                                }
                                return;
                            }
                        } else if (eventDetails.eventInterface === "Logger") {
                            const alerts = await scrypted.systemManager.getComponent('alerts');
                            const ret = await alerts.getAlerts();
                            store.commit("setAlerts", ret);
                        }
                        else if (eventDetails.property === "id") {
                            Vue.delete(systemState, eventData);
                            store.commit("removeDevice", eventData);
                            return;
                        }
                    }
                );

                scrypted.systemManager.getComponent('alerts').then(async (alerts) => {
                    const ret = await alerts.getAlerts();
                    store.commit("setAlerts", ret);
                });
            })
            .catch(e => {
                store.commit("setIsConnected", false);
                throw e;
            });
    };

    Vue.prototype.$connectingScrypted = Vue.prototype.$connectScrypted();
});
