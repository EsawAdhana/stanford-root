"use client"

import * as React from "react"
import { useCourseStore } from "@/lib/store"
import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"

export function LoadingToast() {
    const { isLoading, isEnriching } = useCourseStore()
    // Show if either loading (initial) or enriching (fetching full data).
    // But strictly, the user said "First Load", which is `isLoading`.
    // `isEnriching` happens in background and is less critical to block UI for.
    // We'll stick to `isLoading` for the blocking modal feel, or maybe just `isLoading`.
    // Let's stick to `isLoading` as that's the "cache empty" state.

    const show = isLoading

    const [isVisible, setIsVisible] = React.useState(false)

    React.useEffect(() => {
        let enterTimeout: NodeJS.Timeout
        let exitTimeout: NodeJS.Timeout

        if (show) {
            // Delay showing to prevent flash on fast loads (cache hits)
            enterTimeout = setTimeout(() => {
                setIsVisible(true)
            }, 500)
        } else {
            // If loading finishes, clear the enter timeout so we never show if it was fast
            clearTimeout(enterTimeout!)

            // Delay hiding to allow animation to finish or just be visible for a moment
            // Only set exit timeout if we are currently visible
            setIsVisible(prev => {
                if (prev) {
                    exitTimeout = setTimeout(() => setIsVisible(false), 800)
                    return true
                }
                return false
            })
        }

        return () => {
            clearTimeout(enterTimeout)
            clearTimeout(exitTimeout)
        }
    }, [show])

    if (!isVisible && !show) return null // Optimization: unmount if not visible and not loading

    if (!isVisible) return null

    return (
        <div className={cn(
            "fixed inset-0 z-[100] flex items-end justify-center pb-12 px-4 pointer-events-none",
            "transition-opacity duration-500",
            show ? "opacity-100" : "opacity-0"
        )}>
            <div className={cn(
                "bg-background/80 backdrop-blur-xl border border-border/40 shadow-2xl rounded-2xl p-6 max-w-[340px] text-center",
                "transform transition-all duration-500",
                show ? "translate-y-0 scale-100" : "translate-y-8 scale-95",
                "pointer-events-auto"
            )}>
                <div className="relative h-14 w-14 mx-auto mb-4">
                    <Logo className="w-full h-full object-contain animate-grow-up" />
                </div>

                <p className="text-sm font-medium text-foreground mb-1">
                    Laying down roots...
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    The first time you open Stanford Root, it may take an additional few seconds to render data, but future uses will use cached data and should be near-instantaneous.
                </p>
            </div>
        </div>
    )
}
