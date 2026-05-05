import React from "react";
import { StyleSheet, View } from "react-native";
import { Image as MapboxImage, Images } from "@rnmapbox/maps";
import {
  POI_CATEGORIES,
  POI_MAP_ICON_INSET,
  POI_MAP_ICON_IMAGE_SIZE,
  POI_MAP_ICON_STROKE_WIDTH,
  poiMapIconImageId,
} from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";

const FALLBACK_ICON_NAME = "MapPin";
const iconNames = Array.from(
  new Set([...POI_CATEGORIES.map((category) => category.iconName), FALLBACK_ICON_NAME]),
);

const iconEntries = iconNames.map((iconName) => ({
  imageId: poiMapIconImageId(iconName),
  Icon: POI_ICON_MAP[iconName] ?? POI_ICON_MAP[FALLBACK_ICON_NAME],
}));

function POIMapImages() {
  return (
    <Images>
      {iconEntries.map(({ imageId, Icon }) => (
        <MapboxImage key={imageId} name={imageId} sdf>
          <View style={styles.iconFrame}>
            <Icon
              color="#FFFFFF"
              size={POI_MAP_ICON_IMAGE_SIZE - POI_MAP_ICON_INSET}
              strokeWidth={POI_MAP_ICON_STROKE_WIDTH}
            />
          </View>
        </MapboxImage>
      ))}
    </Images>
  );
}

const styles = StyleSheet.create({
  iconFrame: {
    alignItems: "center",
    backgroundColor: "transparent",
    height: POI_MAP_ICON_IMAGE_SIZE,
    justifyContent: "center",
    width: POI_MAP_ICON_IMAGE_SIZE,
  },
});

export default React.memo(POIMapImages);
