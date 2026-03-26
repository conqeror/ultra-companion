import * as React from "react";
import { Pressable, type PressableProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Text } from "./text";

const buttonVariants = cva(
  "flex-row items-center justify-center rounded-xl",
  {
    variants: {
      variant: {
        default: "bg-primary",
        secondary: "border border-primary bg-transparent",
        destructive: "bg-transparent",
        ghost: "bg-transparent",
      },
      size: {
        default: "h-[52px] px-6",
        sm: "h-[44px] px-4",
        icon: "h-[52px] w-[52px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("font-barlow-semibold text-[15px]", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-primary",
      destructive: "text-destructive",
      ghost: "text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface ButtonProps
  extends PressableProps,
    VariantProps<typeof buttonVariants> {
  label?: string;
  textClassName?: string;
}

const Button = React.forwardRef<React.ComponentRef<typeof Pressable>, ButtonProps>(
  ({ className, textClassName, variant, size, label, children, ...props }, ref) => {
    return (
      <Pressable
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {label ? (
          <Text className={cn(buttonTextVariants({ variant }), textClassName)}>
            {label}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants };
