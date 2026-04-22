import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/cn";
import { Text } from "./text";

const Card = React.forwardRef<View, ViewProps>(({ className, ...props }, ref) => (
  <View
    ref={ref}
    className={cn("rounded-xl border border-border bg-card p-3", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<View, ViewProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={cn("flex-row items-center", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  React.ComponentRef<typeof Text>,
  React.ComponentProps<typeof Text>
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn("flex-1 text-[17px] font-barlow-semibold text-foreground", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<View, ViewProps>(({ className, ...props }, ref) => (
  <View ref={ref} className={className} {...props} />
));
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardContent };
