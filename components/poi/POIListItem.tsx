import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { Star } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import type { CompactPOIRowModel, POIListRowModel } from "@/utils/poiListModels";
import type { DisplayPOI } from "@/types";

interface POIListItemProps {
  model: POIListRowModel | CompactPOIRowModel;
  onPress: (poi: DisplayPOI) => void;
}

function POIListItem({ model, onPress }: POIListItemProps) {
  const colors = useThemeColors();
  const IconComp = POI_ICON_MAP[model.iconName] ?? null;
  const etaOpenColor = model.etaOpeningColorKey ? colors[model.etaOpeningColorKey] : undefined;
  const signedDistanceText =
    "signedDistanceText" in model
      ? model.signedDistanceText
      : model.distanceText == null
        ? null
        : model.distanceDirectionLabel === "behind"
          ? `-${model.distanceText}`
          : model.distanceText;
  const isStarred = "isStarred" in model && model.isStarred;

  return (
    <TouchableOpacity
      className="flex-row items-center px-3 py-2.5 border-b border-border-subtle"
      onPress={() => onPress(model.poi)}
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
    >
      <View
        className="w-[42px] h-[42px] rounded-full items-center justify-center"
        style={{ backgroundColor: model.categoryColor + "1A" }}
      >
        {IconComp && <IconComp size={20} color={model.categoryColor} />}
      </View>

      <View className="flex-1 ml-3 min-w-0">
        <View className="flex-row items-baseline">
          {signedDistanceText != null && (
            <Text className="text-[20px] font-barlow-sc-semibold text-foreground">
              {signedDistanceText}
            </Text>
          )}
          {model.ridingTimeText != null && (
            <Text className="ml-2 text-[18px] text-foreground font-barlow-sc-semibold">
              ~{model.ridingTimeText}
            </Text>
          )}
        </View>
        <View className="flex-row items-center mt-0.5 min-w-0">
          {model.etaOpeningText && etaOpenColor && (
            <>
              <View
                className="w-[5px] h-[5px] rounded-full"
                style={{ backgroundColor: etaOpenColor }}
              />
              <Text className="ml-1 text-[14px] font-barlow-medium" style={{ color: etaOpenColor }}>
                {model.etaOpeningText}
              </Text>
            </>
          )}
          {model.offRouteText && (
            <Text className="ml-2 text-[14px] text-muted-foreground font-barlow-sc-medium">
              {model.offRouteText}
            </Text>
          )}
        </View>
      </View>

      <View className="items-end ml-2 max-w-[42%]">
        <View className="flex-row items-center max-w-full">
          {isStarred && (
            <Star
              size={12}
              color={colors.warning}
              fill={colors.warning}
              style={{ marginRight: 4 }}
            />
          )}
          <Text
            className="text-[14px] font-barlow-medium text-foreground text-right"
            numberOfLines={1}
          >
            {model.title}
          </Text>
        </View>
        <Text
          className="text-[13px] font-barlow-medium text-right"
          style={{ color: model.categoryColor }}
          numberOfLines={1}
        >
          {model.categoryLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(POIListItem);
