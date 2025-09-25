export const plugin = {
    toolDefinition: {
        type: "function",
        name: "presentMap",
        description: "Show a location on a map by providing a location name or address",
        parameters: {
            type: "object",
            properties: {
                location: {
                    type: "string",
                    description: "The location name, address, or place to show on the map (e.g., 'Seattle', 'Paris, France', '123 Main St, New York')",
                },
            },
            required: ["location"],
        },
    },
    execute: async (context, args) => {
        const { location } = args;
        if (!location || typeof location !== "string") {
            throw new Error("Location parameter is required and must be a string");
        }
        return {
            message: `Showing ${location} on the map`,
            location: location,
        };
    },
    generatingMessage: "Loading map...",
    isEnabled: (startResponse) => !!startResponse?.googleMapKey,
};
