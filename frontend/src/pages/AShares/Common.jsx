import React from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

export function numberText(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return "—";
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function amountText(value) {
  if (value === null || value === undefined) return "—";
  if (value >= 100000000) return `${numberText(value / 100000000)} 亿`;
  if (value >= 10000) return `${numberText(value / 10000)} 万`;
  return numberText(value, 0);
}

export function Change({ value }) {
  if (value === null || value === undefined)
    return <span className="ashares-muted">—</span>;
  const className = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className={`ashares-change ${className}`}>
      {value > 0 ? "+" : ""}
      {numberText(value)}%
    </span>
  );
}

export function PageHeading({ title, detail, action }) {
  return (
    <div className="ashares-heading">
      <div>
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function Message({ children, onRetry, tone = "neutral" }) {
  return (
    <div
      className={`ashares-message ${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {tone === "error" && <WarningCircle size={20} />}
      <span>{children}</span>
      {onRetry && (
        <button
          className="ashares-icon-button"
          onClick={onRetry}
          title="重试"
          aria-label="重试"
        >
          <ArrowClockwise size={18} />
        </button>
      )}
    </div>
  );
}

export function IconButton({ label, children, className = "", ...props }) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      title={label}
      aria-label={label}
      className={`ashares-icon-button ${className}`}
    >
      {children}
    </button>
  );
}
