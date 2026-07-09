import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface StatsCardProps {
  title: string
  value: string
  subtitle: string
  icon: LucideIcon
  color: "amber" | "blue" | "emerald" | "purple"
  trend?: number
}

const colorClasses: Record<StatsCardProps["color"], string> = {
  amber: "bg-amber-100 text-amber-600",
  blue: "bg-blue-100 text-blue-600",
  emerald: "bg-emerald-100 text-emerald-600",
  purple: "bg-purple-100 text-purple-600",
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  trend,
}: StatsCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-full",
            colorClasses[color]
          )}
        >
          <Icon className="size-5" />
        </div>
        {typeof trend === "number" && (
          <span
            className={cn(
              "rounded-full px-2 py-1 text-xs font-medium",
              trend >= 0
                ? "bg-emerald-50 text-emerald-600"
                : "bg-red-50 text-red-600"
            )}
          >
            {trend >= 0 ? "+" : ""}
            {trend}%
          </span>
        )}
      </div>
      <p className="mt-5 text-sm font-medium text-zinc-500">{title}</p>
      <p className="mt-1 text-3xl font-bold text-zinc-900">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
    </div>
  )
}
