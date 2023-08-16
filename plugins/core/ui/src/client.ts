import Vue from "vue";
import { checkScryptedClientLogin, connectScryptedClient, getCurrentBaseUrl, loginScryptedClient, redirectScryptedLogin } from '../../../../packages/client/src/index';
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

export function loginScrypted(username: string, password: string, change_password: string) {
    return loginScryptedClient({
        baseUrl: getCurrentBaseUrl(),
        username,
        password,
        change_password,
    });
}

Vue.use(Vue => {
    Vue.prototype.$connectScrypted = () => {
        const clientPromise = connectScryptedClient({
            pluginId: '@scrypted/core',
            // need this in case the scrypted server is proxied.
            baseUrl: getCurrentBaseUrl(),
        });

        store.commit("setLoginHostname", undefined);
        store.commit("setHasLogin", undefined);
        store.commit("setIsLoggedIn", undefined);
        store.commit("setUsername", undefined);
        store.commit("setIsConnected", undefined);

        return checkScryptedClientLogin({
            baseUrl: getCurrentBaseUrl(),
        })
            .then(response => {
                if (response.redirect) {
                    redirectScryptedLogin({
                        redirect: response.redirect,
                        baseUrl: getCurrentBaseUrl(),
                    });
                    return;
                }
                store.commit("setLoginHostname", response.hostname);
                if (!response.expiration) {
                    store.commit("setHasLogin", response.hasLogin);
                    throw new Error("Login failed.");
                }
                store.commit("setHasLogin", true);
                store.commit("setIsLoggedIn", true);
                store.commit("setUsername", response.username);
                setTimeout(() => {
                    store.commit("setIsLoggedIn", false);
                }, response.expiration);
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
