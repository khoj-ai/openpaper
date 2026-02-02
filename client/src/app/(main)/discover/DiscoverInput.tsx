"use client"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Search } from "lucide-react"
import { useRef } from "react"

interface DiscoverInputProps {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    loading: boolean
}

export default function DiscoverInput({ value, onChange, onSubmit, loading }: DiscoverInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (value.trim() && !loading) {
                onSubmit()
            }
        }
    }

    return (
        <div className="w-full max-w-2xl mx-auto space-y-3">
            <h1 className="text-2xl font-semibold text-center">Discover Research</h1>
            <p className="text-sm text-muted-foreground text-center">
                Enter a research question and we&apos;ll find relevant papers across the web.
            </p>
            <div className="flex gap-2">
                <Textarea
                    ref={textareaRef}
                    placeholder="What research questions are you exploring?"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="min-h-[60px] max-h-[120px] resize-none"
                    rows={2}
                />
                <Button
                    onClick={onSubmit}
                    disabled={!value.trim() || loading}
                    className="self-end"
                    size="icon"
                >
                    <Search className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
