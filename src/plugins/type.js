import * as GenerateImagePlugin from "./generateImage";
import * as EditImagePlugin from "./editImage";
import * as BrowsePlugin from "./browse";
import * as MulmocastPlugin from "./mulmocast";
import * as MapPlugin from "./map";
const pluginList = [
    GenerateImagePlugin,
    EditImagePlugin,
    BrowsePlugin,
    MulmocastPlugin,
    MapPlugin,
];
export const pluginTools = (startResponse) => {
    return pluginList
        .filter((plugin) => plugin.plugin.isEnabled(startResponse))
        .map((plugin) => plugin.plugin.toolDefinition);
};
const plugins = pluginList.reduce((acc, plugin) => {
    acc[plugin.plugin.toolDefinition.name] = plugin.plugin;
    return acc;
}, {});
export const pluginExecute = (context, name, args) => {
    console.log("******** Plugin execute", name, args);
    const plugin = plugins[name];
    if (!plugin) {
        throw new Error(`Plugin ${name} not found`);
    }
    return plugin.execute(context, args);
};
export const pluginGeneratingMessage = (name) => {
    const plugin = plugins[name];
    if (!plugin) {
        throw new Error(`Plugin ${name} not found`);
    }
    return plugin.generatingMessage;
};
export const pluginWaitingMessage = (name) => {
    const plugin = plugins[name];
    if (!plugin) {
        throw new Error(`Plugin ${name} not found`);
    }
    return plugin.waitingMessage;
};
