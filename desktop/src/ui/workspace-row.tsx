import { t } from "../i18n";
import { I } from "../icons";
import type { WorkspacePickerRow } from "../workspace-rows";
import { activationHandler } from "./keyboard";

/**
 * One clickable workspace row: icon, name, full path, and a current-check or
 * remove button. Every workspace picker renders its rows through this, so the
 * local workspace is labelled, the current one is marked and a row is picked or
 * forgotten by one rule across surfaces.
 */
export function WorkspaceRowView({
  row,
  onPick,
  onRemove,
  locked = false,
}: {
  row: WorkspacePickerRow;
  /** The user chose this row. Not called for the workspace already in use. */
  onPick: () => void;
  /** Absent for a row this picker may not forget (the pinned local workspace). */
  onRemove?: () => void;
  /** A session mutation is in flight: the row switches nothing and removes nothing. */
  locked?: boolean;
}) {
  const removable = row.canRemove && onRemove !== undefined;
  // The workspace already in use is not a destination: picking it again would
  // re-enter it (and, on the daemon side, start a new chat there).
  const pick = locked || row.isCurrent ? undefined : onPick;
  return (
    <div
      className="wd-row"
      onClick={pick}
      onKeyDown={pick ? activationHandler(pick) : undefined}
      title={row.path}
      aria-disabled={locked || undefined}
      data-locked={locked ? "true" : undefined}
    >
      <span className="ic">{row.local ? <I.terminal size={12} /> : <I.folder size={12} />}</span>
      <div className="b">
        <div className="p">{row.local ? t("workdir.reasonixLocal") : row.name}</div>
        <div className="br">{row.path}</div>
      </div>
      {row.isCurrent ? (
        <span className="pin">
          <I.check size={11} />
        </span>
      ) : removable ? (
        <button
          type="button"
          className="wd-del"
          title={t("workdir.removeRecent")}
          aria-label={t("workdir.removeRecent")}
          disabled={locked}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onRemove();
            }
          }}
        >
          <I.x size={11} />
        </button>
      ) : null}
    </div>
  );
}
