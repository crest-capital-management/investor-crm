"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ToastVariant = "success" | "error";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function dismiss(id: number) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function toast(message: string, variant: ToastVariant = "success") {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, variant }]);
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed right-6 bottom-6 z-[70] flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-2">
        {toasts.map((item) => (
          <ToastItem key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  item,
  onDismiss,
}: {
  item: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(item.id), 4000);
    return () => window.clearTimeout(timeout);
  }, [item.id, onDismiss]);

  const isSuccess = item.variant === "success";

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm text-foreground shadow-lg ${
        isSuccess
          ? "border-green-200"
          : "border-destructive/30"
      }`}
    >
      {isSuccess ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <p className="min-w-0 flex-1">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-1 rounded p-1 text-current/70 hover:bg-muted hover:text-current"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
