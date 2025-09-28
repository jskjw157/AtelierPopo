import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // 기존 프로젝트 스타일과 정확히 일치하는 스타일
        "w-full px-4 py-3 border border-gray-200 rounded-lg bg-white text-sm",
        "focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none",
        "placeholder:text-gray-500 transition-all duration-200",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
