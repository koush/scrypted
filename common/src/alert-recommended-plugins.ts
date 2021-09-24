import sdk from "@scrypted/sdk";

const { systemManager, log } = sdk;

export async function alertRecommendedPlugins(plugins: { [pkg: string]: string }) {
    const pluginsComponent = await systemManager.getComponent('plugins');
    let recommended: any;
    try {
        recommended = JSON.parse(localStorage.getItem('alert-recommended'));
    }
    catch (e) {
        recommended = {};
    }
    for (const plugin of Object.keys(plugins)) {
        try {
            if (recommended[plugin])
                continue;

            recommended[plugin] = true;
            localStorage.setItem('alert-recommended', JSON.stringify(recommended));
            const id = await pluginsComponent.getIdForPluginId(plugin);
            if (id)
                continue;
            const name = plugins[plugin];
            log.a(`Installation of the ${name} plugin is also recommended. origin:/#/component/plugin/install/${plugin}`)
        }
        catch (e) {
        }
    }
}
