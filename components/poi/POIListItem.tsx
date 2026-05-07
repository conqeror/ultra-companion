import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { Star } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import type { POIListRowModel } from "@/utils/poiListModels";
import type { DisplayPOI } from "@/types";

interface POIListItemProps {
  model: POIListRowModel;
  onPress: (poi: DisplayPOI) => void;
}

function POIListItem({ model, onPress }: POIListItemProps) {
  const colors = useThemeColors();
  const IconComp = POI_ICON_MAP[model.iconName] ?? null;
  const ohColor = model.openingHoursColorKey ? colors[model.openingHoursColorKey] : undefined;

  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3.5 border-b border-border"
      onPress={() => onPress(model.poi)}
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
    >
      <View
        className="w-[40px] h-[40px] rounded-full items-center justify-center"
        style={{ backgroundColor: model.categoryColor + "1A" }}
      >
        {IconComp && <IconComp size={20} color={model.categoryColor} />}
      </View>

      <View className="flex-1 ml-3">
        <View className="flex-row items-baseline">
          {model.distanceText != null && (
            <Text className="text-[18px] font-barlow-sc-semibold text-foreground">
              {model.distanceDirectionLabel === "behind"
                ? `-${model.distanceText}`
                : model.distanceText}
            </Text>
          )}
          {model.ridingTimeText ? (
            <Text className="ml-2 text-[15px] font-barlow-sc-semibold text-foreground">
              ~{model.ridingTimeText}
            </Text>
          ) : model.distanceDirectionLabel ? (
            <Text className="ml-2 text-[14px] font-barlow-medium text-muted-foreground">
              {model.distanceDirectionLabel}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center">
          {model.isStarred && (
            <Star
              size={12}
              color={colors.warning}
              fill={colors.warning}
              style={{ marginRight: 4 }}
            />
          )}
          <Text
            className="text-[14px] font-barlow-medium text-foreground flex-shrink"
            numberOfLines={1}
          >
            {model.title}
          </Text>
        </View>
        <View className="flex-row items-center mt-1">
          {model.openingHoursText && (
            <View className="flex-row items-center">
              <View className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: ohColor }} />
              <Text className="ml-1 text-[14px] font-barlow-medium" style={{ color: ohColor }}>
                {model.openingHoursText}
              </Text>
            </View>
          )}
          {model.openingHoursText && model.offRouteText && (
            <Text className="text-[14px] text-muted-foreground font-barlow ml-2">
              {model.offRouteText}
            </Text>
          )}
          {!model.openingHoursText && model.offRouteText && (
            <Text className="text-[14px] text-muted-foreground font-barlow">
              {model.offRouteText} route
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(POIListItem);
