import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Text } from "./text";

const badgeVariants = cva("flex-row items-center rounded-full px-2 py-0.5", {
  variants: {
    variant: {
      default: "bg-primary/10",
      destructive: "bg-destructive/10",
      outline: "border border-border",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const badgeTextVariants = cva("text-[11px] font-barlow-sc-medium", {
  variants: {
    variant: {
      default: "text-primary",
      destructive: "text-destructive",
      outline: "text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface BadgeProps extends ViewProps, VariantProps<typeof badgeVariants> {
  label: string;
  textClassName?: string;
}

function Badge({ className, textClassName, variant, label, ...props }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)} {...props}>
      <Text className={cn(badgeTextVariants({ variant }), textClassName)}>{label}</Text>
    </View>
  );
}

export { Badge, badgeVariants };
