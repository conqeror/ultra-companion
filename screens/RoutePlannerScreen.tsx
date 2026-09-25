import React from "react";
import { Redirect } from "expo-router";

// Planning is currently supported only by the iOS surface.
export default function RoutePlannerScreen() {
  return <Redirect href="/routes" />;
}
