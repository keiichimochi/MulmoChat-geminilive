import { generateImageCommon } from "./generateImage";
const toolDefinition = {
    type: "function",
    name: "editImage",
    description: "Edit the previously generated image based on a text prompt.",
    parameters: {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "Description of the edits to be made to the image in English",
            },
        },
        required: ["prompt"],
    },
};
const editImage = async (context, args) => {
    const prompt = args.prompt;
    console.log("******** Edit image", prompt);
    return generateImageCommon(context, prompt, true);
};
export const plugin = {
    toolDefinition,
    execute: editImage,
    generatingMessage: "Editing image...",
    isEnabled: () => true,
};
