import {
  Ambulance,
  Beer,
  Bike,
  Bus,
  CircleDot,
  Coffee,
  Droplets,
  Croissant,
  Dumbbell,
  Fuel,
  HeartPulse,
  Hospital,
  Landmark,
  MapPin,
  Phone,
  Pill,
  School,
  ShoppingCart,
  Tent,
  Toilet,
  TrainFront,
  Utensils,
  Wrench,
} from "lucide-react-native";
import type { ComponentType } from "react";

type POIIconComponent = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

/** Shared icon map for POI categories, keyed by POICategoryMeta.iconName */
export const POI_ICON_MAP: Record<string, POIIconComponent> = {
  Ambulance,
  Beer,
  Bike,
  Bus,
  CircleDot,
  Coffee,
  Droplets,
  Croissant,
  Dumbbell,
  Fuel,
  HeartPulse,
  Hospital,
  Landmark,
  MapPin,
  Phone,
  Pill,
  School,
  ShoppingCart,
  Tent,
  Toilet,
  TrainFront,
  Utensils,
  Wrench,
};
