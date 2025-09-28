import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-pink-500 hover:bg-pink-600 text-white",
        destructive: "bg-red-500 text-white hover:bg-red-600",
        outline:
          "border border-pink-500 text-pink-500 hover:bg-pink-50 bg-white",
        secondary:
          "border border-gray-200 text-gray-700 hover:bg-gray-50 bg-white",
        ghost: "text-gray-700 hover:text-pink-500 hover:bg-pink-50",
        link: "text-pink-500 underline-offset-4 hover:underline",
        // 기존 프로젝트 스타일과 정확히 일치하는 커스텀 variants
        pinkPrimary:
          "bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-medium transition-all duration-200",
        pinkOutline:
          "border border-pink-500 text-pink-500 hover:bg-pink-50 rounded-lg transition-all duration-200",
        pinkSecondary:
          "bg-pink-100 hover:bg-pink-200 text-pink-700 border border-pink-200 rounded-lg font-semibold transition-all duration-200",
        grayOutline:
          "border-2 border-gray-300 hover:border-pink-500 text-gray-700 hover:text-pink-500 rounded-full font-medium transition-all duration-300",
        heroRounded:
          "bg-pink-500 hover:bg-pink-600 text-white rounded-full font-medium transition-all duration-300 shadow-lg hover:shadow-xl",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-2 text-sm",
        lg: "px-6 py-3",
        xl: "px-8 py-4",
        icon: "p-2",
        // 기존 프로젝트에서 사용하는 사이즈들
        heroButton: "px-8 py-4 text-base",
        productButton: "py-2 px-4",
        checkoutButton: "py-3 px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
