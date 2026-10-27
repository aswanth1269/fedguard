"use client";

import { useToasts, toastStore, type ToastType } from "@/lib/store";
import { CheckCircle, Warning, Info, XCircle, X } from "@phosphor-icons/react";

export function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: { id: string; title: string; description?: string; type: ToastType } }) {
  const icons = {
    success: <CheckCircle size={20} weight="fill" className="text-[var(--status-good)] shrink-0" />,
    warning: <Warning size={20} weight="fill" className="text-[var(--status-warning)] shrink-0" />,
    error: <XCircle size={20} weight="fill" className="text-[var(--status-critical)] shrink-0" />,
    info: <Info size={20} weight="fill" className="text-[var(--status-info)] shrink-0" />,
  };

  const borders = {
    success: "border-[var(--status-good)]/30",
    warning: "border-[var(--status-warning)]/30",
    error: "border-[var(--status-critical)]/30",
    info: "border-[var(--status-info)]/30",
  };

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 glass-card-elevated p-4 rounded-xl shadow-2xl border ${borders[toast.type]} animate-in slide-in-from-bottom-5 duration-300`}
      role="alert"
    >
      <div className="mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <h4 className="text-[13.5px] font-semibold text-[var(--ink-primary)]">{toast.title}</h4>
        {toast.description && (
          <p className="mt-0.5 text-[12px] text-[var(--ink-secondary)] leading-relaxed">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => toastStore.remove(toast.id)}
        className="text-[var(--ink-muted)] hover:text-[var(--ink-primary)] p-1 rounded-md transition-colors cursor-pointer"
        aria-label="Dismiss toast"
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}
