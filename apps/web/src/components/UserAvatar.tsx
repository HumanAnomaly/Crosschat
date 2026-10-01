import { useState } from "react";
import type { SessionUser } from "../api";

function initialsOf(displayName: string): string {
  const clean = displayName.trim();
  if (!clean) return "?";
  if (clean.includes("@") && !clean.includes(" ")) {
    return clean.slice(0, 1).toUpperCase();
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

function normalizePicture(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

interface UserAvatarProps {
  user: Pick<SessionUser, "name" | "email" | "picture">;
  size?: "sm" | "md" | "lg";
  ring?: boolean;
}

const sizes = {
  sm: { box: "w-8 h-8", text: "text-xs", img: 64 },
  md: { box: "w-10 h-10", text: "text-sm", img: 80 },
  lg: { box: "w-12 h-12", text: "text-base", img: 96 },
} as const;

export default function UserAvatar({ user, size = "md", ring = false }: UserAvatarProps) {

  const displayName = user?.name?.trim() || user?.email?.trim() || "Account";
  const src = normalizePicture(user?.picture);
  const [broken, setBroken] = useState(false);
  const s = sizes[size];

  if (src && !broken) {
    return (
      <div className="avatar">
        <div className={`${s.box} rounded-full${ring ? " ring-primary ring-offset-base-100 ring-2 ring-offset-2" : ""}`}>
          <img
            src={src}
            alt={displayName}
            width={s.img}
            height={s.img}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full rounded-full object-cover"
            onError={() => setBroken(true)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="avatar avatar-placeholder">
      <div className={`bg-neutral text-neutral-content ${s.box} rounded-full`}>
        <span className={`${s.text} font-bold`}>{initialsOf(displayName)}</span>
      </div>
    </div>
  );
}
