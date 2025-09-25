const toolDefinition = {
    type: "function",
    name: "generateImage",
    description: "Generate an image from a text prompt.",
    parameters: {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "Description of the desired image in English",
            },
        },
        required: ["prompt"],
    },
};
export async function generateImageCommon(context, prompt, editImage) {
    try {
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ prompt, images: editImage ? context.images : [] }),
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success && data.imageData) {
            console.log("*** Image generation succeeded", data.imageData.length);
            return {
                imageData: data.imageData,
                message: "image generation succeeded",
                instructions: "Acknowledge that the image was generated and has been already presented to the user.",
            };
        }
        else {
            console.log("*** Image generation failed");
            return {
                message: data.message || "image generation failed",
                instructions: "Acknowledge that the image generation failed.",
            };
        }
    }
    catch (error) {
        console.error("*** Image generation failed", error);
        return {
            message: "image generation failed",
            instructions: "Acknowledge that the image generation failed.",
        };
    }
}
const generateImage = async (context, args) => {
    const prompt = args.prompt;
    console.log("******** Generate image", prompt);
    return generateImageCommon(context, prompt, false);
};
export const plugin = {
    toolDefinition,
    execute: generateImage,
    generatingMessage: "Generating image...",
    isEnabled: () => true,
};
