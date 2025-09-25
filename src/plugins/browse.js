const toolDefinition = {
    type: "function",
    name: "browse",
    description: "Browse and extract content from a web page using the provided URL.",
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The URL of the webpage to browse and extract content from",
            },
        },
        required: ["url"],
    },
};
const browse = async (context, args) => {
    const url = args.url;
    console.log("******** Browse URL", url);
    try {
        const response = await fetch("/api/browse", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.success && data.data) {
            console.log("*** Browse succeeded", data.data);
            return {
                message: "Successfully browsed the webpage",
                title: data.data.data.title || "Untitled",
                url,
                jsonData: data.data,
                instructions: "Acknowledge that the webpage was successfully browsed and the content has been retrieved. Just read the title, but don't read the contents unlil the user asks for it.",
            };
        }
        else {
            console.log("*** Browse failed");
            return {
                message: data.error || "Failed to browse webpage",
                instructions: "Acknowledge that the webpage browsing failed.",
            };
        }
    }
    catch (error) {
        console.error("*** Browse failed", error);
        return {
            message: `Failed to browse webpage: ${error instanceof Error ? error.message : "Unknown error"}`,
            instructions: "Acknowledge that the webpage browsing failed.",
        };
    }
};
export const plugin = {
    toolDefinition,
    execute: browse,
    generatingMessage: "Browsing webpage...",
    waitingMessage: "Tell the user to that you are accessing the specified web page.",
    isEnabled: () => true,
};
