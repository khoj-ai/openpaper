"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
	className,
	value,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	// Extract bg-color from the className
	const bgColor = className?.match(/bg-([a-zA-Z0-9-]+)/)?.[1];
	const bgColorClass = bgColor ? `bg-${bgColor}` : "bg-primary";

	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn(
				"!bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
				className
			)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className={cn("bg-primary h-full w-full flex-1 transition-all", bgColorClass)}
				style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
			/>
		</ProgressPrimitive.Root>
	)
}

export { Progress }
