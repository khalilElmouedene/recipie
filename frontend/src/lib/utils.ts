import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "text-green-400";
    case "completed":
      return "text-blue-400";
    case "failed":
      return "text-red-400";
    case "stopped":
      return "text-yellow-400";
    default:
      return "text-gray-400";
  }
}

export function statusBg(status: string): string {
  switch (status) {
    case "running":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "completed":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "failed":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "stopped":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    default:
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}
