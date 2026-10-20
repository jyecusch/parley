import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** Joins class names, letting later Tailwind utilities override earlier ones (so a className prop wins). */
export const cn = (...inputs: Array<ClassValue>) => twMerge(clsx(inputs))
