import { ref, onMounted, watch } from "vue";
const props = defineProps({
    location: {
        type: [Object, String],
        required: true,
        validator: (value) => {
            if (typeof value === "string")
                return value.length > 0;
            return (value && typeof value.lat === "number" && typeof value.lng === "number");
        },
    },
    apiKey: {
        type: String,
        required: true,
    },
    zoom: {
        type: Number,
        default: 15,
    },
});
const mapContainer = ref(null);
let map = null;
let marker = null;
let geocoder = null;
const geocodeLocation = (locationName) => {
    return new Promise((resolve, reject) => {
        geocoder.geocode({ address: locationName }, (results, status) => {
            if (status === "OK" && results[0]) {
                const location = results[0].geometry.location;
                resolve({ lat: location.lat(), lng: location.lng() });
            }
            else {
                reject(new Error(`Geocoding failed: ${status}`));
            }
        });
    });
};
const getCoordinates = async (location) => {
    if (typeof location === "string") {
        return await geocodeLocation(location);
    }
    return location;
};
const initMap = async () => {
    geocoder = new google.maps.Geocoder();
    try {
        // Import the marker library
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
        const coordinates = await getCoordinates(props.location);
        map = new google.maps.Map(mapContainer.value, {
            center: coordinates,
            zoom: props.zoom,
            mapId: "DEMO_MAP_ID",
        });
        marker = new AdvancedMarkerElement({
            position: coordinates,
            map: map,
        });
    }
    catch (error) {
        console.error("Error initializing map:", error);
    }
};
const updateLocation = async (newLocation) => {
    if (map && marker) {
        try {
            const coordinates = await getCoordinates(newLocation);
            map.setCenter(coordinates);
            marker.position = coordinates;
        }
        catch (error) {
            console.error("Error updating location:", error);
        }
    }
};
const loadGoogleMapsAPI = () => {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${props.apiKey}&libraries=geometry`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google Maps API"));
        document.head.appendChild(script);
    });
};
onMounted(async () => {
    try {
        await loadGoogleMapsAPI();
        await initMap();
    }
    catch (error) {
        console.error("Error loading Google Maps:", error);
    }
});
watch(() => props.location, updateLocation, { deep: true });
watch(() => props.zoom, (newZoom) => {
    if (map) {
        map.setZoom(newZoom);
    }
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_elements;
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ref: "mapContainer",
    ...{ class: "map-container" },
});
/** @type {typeof __VLS_ctx.mapContainer} */ ;
// @ts-ignore
[mapContainer,];
/** @type {__VLS_StyleScopedClasses['map-container']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup: () => ({
        ...props,
        ...{},
        mapContainer: mapContainer,
    }),
});
export default (await import('vue')).defineComponent({
    setup: () => ({
        ...props,
        ...{},
    }),
});
; /* PartiallyEnd: #4569/main.vue */
