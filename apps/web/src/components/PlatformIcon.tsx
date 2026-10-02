import { MessageCircle } from "lucide-react";
import { SiDiscord, SiTelegram, SiWhatsapp } from "react-icons/si";
import type { IconType } from "react-icons";
import type { Platform } from "@crosschat/core";

const BRANDS: Record<string, IconType> = {
  telegram: SiTelegram,
  discord: SiDiscord,
  whatsapp: SiWhatsapp,
};

interface PlatformIconProps {
  platform: Platform;
  size?: number;
  className?: string;
}

/**
 * Brand tile resolved from the platform registry entry. Unknown icon keys
 * fall back to a neutral glyph so new platforms never render broken.
 */
export default function PlatformIcon({ platform, size = 16, className }: PlatformIconProps) {
  const Brand = BRANDS[platform.icon];
  if (!Brand) return <MessageCircle size={size} className={className} aria-hidden="true" />;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-white ${className ?? ""}`}
      style={{ backgroundColor: platform.brandColor }}
      aria-hidden="true"
    >
      <Brand size={size} />
    </span>
  );
}
