"use client";

import { useSyncExternalStore } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export type ToastMessage = {
  id: string;
  title: string;
  description?: string;
  type: ToastType;
  duration?: number;
};

let toasts: ToastMessage[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export const toastStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return toasts;
  },
  add(toast: Omit<ToastMessage, "id">) {
    const id = Math.random().toString(36).substring(2, 9);
    const item: ToastMessage = { ...toast, id };
    toasts = [...toasts, item];
    notify();

    const duration = toast.duration ?? 4000;
    setTimeout(() => {
      toastStore.remove(id);
    }, duration);
  },
  remove(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  },
  success(title: string, description?: string) {
    toastStore.add({ title, description, type: "success" });
  },
  error(title: string, description?: string) {
    toastStore.add({ title, description, type: "error" });
  },
  info(title: string, description?: string) {
    toastStore.add({ title, description, type: "info" });
  },
  warning(title: string, description?: string) {
    toastStore.add({ title, description, type: "warning" });
  },
};

export function useToasts() {
  return useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => []);
}

export async function copyToClipboard(text: string, label = "Item"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toastStore.success(`${label} copied to clipboard`, text.length > 32 ? `${text.slice(0, 32)}...` : text);
    return true;
  } catch {
    toastStore.error(`Failed to copy ${label}`);
    return false;
  }
}
