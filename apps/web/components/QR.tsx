"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ value, size, label }: { value: string; size: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#09090B", light: "#FAFAFA" }, errorCorrectionLevel: "M" }).then(setSrc);
  }, [value, size]);
  return (
    <div role="img" aria-label={label} style={{ width: size, height: size, borderRadius: size > 160 ? 16 : 12, background: "#FAFAFA", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flex: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" width={size - 16} height={size - 16} />}
    </div>
  );
}
