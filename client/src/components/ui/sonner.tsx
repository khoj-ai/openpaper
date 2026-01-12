"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ position = "top-right", ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={position}
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          actionButton: "!bg-primary !text-primary-foreground !font-medium !rounded-md !px-3 !py-1.5 !text-sm !transition-colors !shadow-sm hover:!bg-primary/90",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
