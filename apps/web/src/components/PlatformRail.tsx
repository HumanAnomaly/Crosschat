import { PLATFORMS, type Platform } from "@crosschat/core";
import PlatformIcon from "./PlatformIcon";

interface Props {
  /** Platform id of the active room, if any. */
  connectedId: string | null;
  onSelect: (id: string) => void;
  /** Resolved registry (env overrides applied). Defaults to PLATFORMS. */
  platforms?: Platform[];
}

/**
 * The platform rail is rendered straight from the registry, so every platform
 * gets the same affordances and none of them is treated as the default.
 */
export default function PlatformRail({ connectedId, onSelect, platforms = PLATFORMS }: Props) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Link a platform">
      {platforms.map((p) => {
        const active = connectedId === p.id;
        return (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`btn btn-sm gap-2 ${active ? "btn-outline" : "btn-neutral"}`}
              aria-label={
                active
                  ? `${p.label} is linked. Show linking steps.`
                  : `Link ${p.label}. Show linking steps.`
              }
            >
              <PlatformIcon platform={p} size={14} />
              <span>{p.label}</span>
              {active && <span className="badge badge-success badge-xs" aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
