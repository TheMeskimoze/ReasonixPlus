import { groupSkills, isSkillCollection } from "@reasonix/core-utils";
import { type CSSProperties, type ReactNode, useState } from "react";
import { I } from "../icons";
import type {
  CapabilityChoice,
  McpSetupServer,
  PluginSetupEntry,
  SkillSetupEntry,
} from "../protocol";
import { Throbber } from "./throbber";

/** The keys a capability dialog starts with switched on: the rows the daemon marked
 *  enabled, under the identity the confirm freezes for that kind. */
function switchedOn<T extends { enabled: boolean }>(
  rows: readonly T[],
  key: (row: T) => string,
): Set<string> {
  return new Set(rows.filter((row) => row.enabled).map(key));
}

/** Flip a set of names at once: one switch for everything an install delivered, so a
 *  collection of twenty skills cannot cost twenty clicks. */
function setMany(current: Set<string>, names: readonly string[], on: boolean): Set<string> {
  const next = new Set(current);
  for (const name of names) {
    if (on) next.add(name);
    else next.delete(name);
  }
  return next;
}

/** Flip one name in a switch-set, for the rows that stand for a single capability. Server,
 *  plugin and skill rows share this so the three kinds cannot answer a click differently. */
function flipped(current: Set<string>, name: string): Set<string> {
  return setMany(current, [name], !current.has(name));
}

/** The capability question, asked in one dialog wherever it is asked: the session-start
 *  gate ("what may this chat run with?") and the Duplicate confirm ("what may the copy
 *  run with?"). A caller supplies the copy and the answer handler and nothing else, so
 *  the two questions cannot drift apart. */
export function CapabilityDialog({
  title,
  hint,
  servers,
  plugins,
  skills,
  subagents,
  emptyHint,
  confirmLabel,
  busyLabel,
  dismissLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  hint: string;
  servers: McpSetupServer[];
  /** Installed plugins, each switched on by the seed's frozen set. Their MCP servers and
   *  skills travel with them, so they get no rows of their own. */
  plugins: PluginSetupEntry[];
  /** Installed standalone skills, switched on by the seed's frozen set. */
  skills: SkillSetupEntry[];
  /** Which switches start on: the capability seed the caller opened with. */
  subagents: boolean;
  emptyHint?: string;
  confirmLabel: string;
  /** Copy the confirm shows while the answer is being applied. Absent means the caller
   *  dismisses on click, so there is no wait to report. */
  busyLabel?: string;
  dismissLabel: string;
  onConfirm: (answer: CapabilityChoice) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    switchedOn(servers, (server) => server.name),
  );
  const [chosenPlugins, setChosenPlugins] = useState<Set<string>>(() =>
    switchedOn(plugins, (plugin) => plugin.name),
  );
  const [chosenSkills, setChosenSkills] = useState<Set<string>>(() =>
    switchedOn(skills, (skill) => skill.id),
  );
  const [spawn, setSpawn] = useState(subagents);
  const [busy, setBusy] = useState(false);
  // Bridging the confirmed servers takes seconds and the gate stays up until $ready, so
  // the confirm click must read as "working", not as a dead button.
  const confirming = busy && busyLabel !== undefined;
  const toggleSkills = (names: readonly string[], on: boolean) =>
    setChosenSkills((prev) => setMany(prev, names, on));
  return (
    <div
      className="mcp-setup-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={OVERLAY_STYLE}
    >
      <div className="mcp-setup-card" style={CARD_STYLE}>
        <div style={HEADER_STYLE}>
          <h2 style={TITLE_STYLE}>{title}</h2>
          <button
            type="button"
            className="mini-btn"
            aria-label={dismissLabel}
            title={dismissLabel}
            onClick={onCancel}
          >
            <I.x size={14} />
          </button>
        </div>
        <p className="mcp-setup-hint" style={HINT_STYLE}>
          {hint}
        </p>
        <CapabilityPicker
          servers={servers}
          plugins={plugins}
          skills={skills}
          selected={selected}
          chosenPlugins={chosenPlugins}
          chosenSkills={chosenSkills}
          onToggleServer={(name) => setSelected((prev) => flipped(prev, name))}
          onTogglePlugin={(name) => setChosenPlugins((prev) => flipped(prev, name))}
          onToggleSkills={toggleSkills}
          emptyHint={emptyHint}
        />
        <div className="mcp-setup-actions" style={ACTIONS_STYLE}>
          <div style={SUBAGENTS_STYLE}>
            <span style={SUBAGENTS_TEXT_STYLE}>{SUBAGENTS_LABEL}</span>
            <Switch on={spawn} label={SUBAGENTS_LABEL} onToggle={() => setSpawn((on) => !on)} />
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={confirming}
            aria-busy={confirming}
            onClick={() => {
              setBusy(true);
              onConfirm({
                servers: [...selected],
                plugins: [...chosenPlugins],
                skills: [...chosenSkills],
                subagents: spawn,
              });
            }}
          >
            {confirming && busyLabel ? <Throbber label={busyLabel} /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The captured capability kinds, one column each: a plugin set, a standalone skill set and
 *  an MCP server set answer different questions, so no kind can push another down the
 *  dialog and a long list in one column costs nothing to the other two. */
function CapabilityPicker({
  servers,
  plugins,
  skills,
  selected,
  chosenPlugins,
  chosenSkills,
  onToggleServer,
  onTogglePlugin,
  onToggleSkills,
  emptyHint = "None configured. Add servers in Settings, then open a new chat.",
}: {
  servers: McpSetupServer[];
  plugins: PluginSetupEntry[];
  skills: SkillSetupEntry[];
  /** Names of the servers currently switched on. */
  selected: ReadonlySet<string>;
  /** Slugs of the plugins currently switched on. */
  chosenPlugins: ReadonlySet<string>;
  /** Ids of the standalone skills currently switched on. */
  chosenSkills: ReadonlySet<string>;
  onToggleServer: (name: string) => void;
  onTogglePlugin: (name: string) => void;
  onToggleSkills: (ids: readonly string[], on: boolean) => void;
  emptyHint?: string;
}) {
  return (
    <div className="mcp-setup-caps" style={CAPS_GRID}>
      <CapabilityColumn label="Plugins">
        <SetupList
          rows={plugins.map((plugin) => ({
            name: plugin.displayName,
            on: chosenPlugins.has(plugin.name),
            onToggle: () => onTogglePlugin(plugin.name),
          }))}
          empty="No plugin installed. Install one in Settings, under Plugins, then open a new chat."
        />
      </CapabilityColumn>
      <CapabilityColumn label="Skills">
        <SetupList rows={skillRows(skills, chosenSkills, onToggleSkills)} empty={NO_SKILLS_NOTE} />
      </CapabilityColumn>
      <CapabilityColumn label="MCP servers">
        <SetupList
          rows={servers.map((server) => ({
            name: server.name,
            badge: server.builtin ? "built-in" : undefined,
            on: selected.has(server.name),
            onToggle: () => onToggleServer(server.name),
          }))}
          empty={emptyHint}
        />
      </CapabilityColumn>
    </div>
  );
}

/** The dialog's frame: a dimmed backdrop with the card centered on it. */
const OVERLAY_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.5)",
};

/** The card: wide enough for three columns of rows beside their switches, and capped so the
 *  footer never leaves the viewport. */
const CARD_STYLE: CSSProperties = {
  width: 880,
  maxWidth: "94vw",
  maxHeight: "86vh",
  display: "flex",
  flexDirection: "column",
  padding: 20,
  borderRadius: 10,
  background: "var(--card)",
  color: "var(--fg)",
};

/** The heading line: the title on the left, the dismiss control on the right. */
const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
  flexShrink: 0,
};

const TITLE_STYLE: CSSProperties = { margin: "0 0 6px", fontSize: 13, fontWeight: 600 };

const HINT_STYLE: CSSProperties = { margin: "0 0 12px", opacity: 0.75, flexShrink: 0 };

/** The footer: the subagent flag on the left, the confirm on the right, outside the columns
 *  so neither the flag nor the confirm can be scrolled away. */
const ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
  flexShrink: 0,
};

/** The footer's flag: its label beside the switch it names. */
const SUBAGENTS_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };

const SUBAGENTS_TEXT_STYLE: CSSProperties = { opacity: 0.75 };

/** The subagent flag's name, shared by its visible text and its switch's accessible name so
 *  the two cannot disagree. */
const SUBAGENTS_LABEL = "Subagents";

/** One switch, wherever it sits: a switch keeps its width when its row's text grows. */
const SWITCH_STYLE: CSSProperties = { flexShrink: 0 };

/** The three columns. Each one owns its scrolling, so the card's height stays fixed however
 *  many capabilities are installed. */
const CAPS_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 16,
  flex: 1,
  minHeight: 0,
};

/** One column: a heading that stays put and a body that scrolls under it. */
const COLUMN_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
};

/** A column's heading: the same for every kind, and never scrolled away. The horizontal
 *  padding matches a row's, so a heading sits on the same edge as the names under it. */
const COLUMN_LABEL_STYLE: CSSProperties = {
  margin: "0 0 6px",
  padding: "0 8px",
  flexShrink: 0,
  fontSize: "0.8em",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  opacity: 0.55,
};

const COLUMN_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  scrollbarGutter: "stable",
  paddingRight: 4,
};

/** Name and description above the switch, so a row stays readable in a third of the card. */
const ROW_COLUMNS = "minmax(0, 1fr) auto";

/** The text side of a row: it wraps instead of widening past the column. */
const ROW_TEXT: CSSProperties = { minWidth: 0, overflowWrap: "anywhere" };

const ROW_TEXT_STACK: CSSProperties = {
  ...ROW_TEXT,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

/** A row: its text on the left and its switch in the column that ends at the row's right
 *  edge, so every switch in a column shares one vertical line. */
const ROW_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: ROW_COLUMNS,
  alignItems: "center",
  columnGap: 8,
  padding: "6px 8px",
  borderRadius: 6,
};

/** A row's second line: quieter than its name, whether it reports a description or a
 *  collection's share of switches. */
const BADGE_STYLE: CSSProperties = { ...ROW_TEXT, opacity: 0.6, fontSize: "0.85em" };

/** The list of one capability kind. Every kind shares it, so none of them can indent its
 *  rows away from the switch column. */
const LIST_STYLE: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

/** How an empty note reads: the same quiet voice for every kind, on the edge its rows would
 *  have started at. */
const EMPTY_NOTE_STYLE: CSSProperties = { margin: 0, padding: "0 8px", opacity: 0.6 };

/** The empty note the skills section shows: the only kind whose emptiness has two reasons. */
const NO_SKILLS_NOTE =
  "No standalone skill installed. Install one in Settings, under Skills, then open a new chat. Skills a plugin ships arrive with that plugin.";

/** One capability a row switches, in the shape a kind's list hands it to the row. */
type SetupEntry = {
  /** The row's identity when it is not its label, as a repository key is not its display
   *  name: two kinds of group can share a label but never a key. */
  identity?: string;
  name: string;
  badge?: string;
  on: boolean;
  onToggle: () => void;
};

/** One kind's column: the heading names the kind, the body holds its rows and scrolls under
 *  that heading. */
function CapabilityColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} style={COLUMN_STYLE}>
      <p className="mcp-setup-hint" style={COLUMN_LABEL_STYLE}>
        {label}
      </p>
      <div style={COLUMN_BODY_STYLE}>{children}</div>
    </section>
  );
}

/** What a kind shows in place of the rows it has none of. */
function EmptyNote({ children }: { children: string }) {
  return (
    <p className="mcp-setup-hint" style={EMPTY_NOTE_STYLE}>
      {children}
    </p>
  );
}

/** The list of one capability kind. Every kind shares it, so none of them can indent its
 *  rows away from the switch column, stripe them differently, or forget the note it shows
 *  when it has no rows. */
function SetupList({ rows, empty }: { rows: SetupEntry[]; empty?: string }) {
  if (rows.length === 0) return empty ? <EmptyNote>{empty}</EmptyNote> : null;
  return (
    <ul className="mcp-setup-list" style={LIST_STYLE}>
      {rows.map(({ identity, ...row }, i) => (
        <SetupRow key={identity ?? row.name} {...row} striped={i % 2 === 1} />
      ))}
    </ul>
  );
}

/** The skill column's rows: one switch per install. A repository switches as one capability,
 *  so its members never appear as switches of their own: the row's badge says how much of
 *  the group is on, and the settings page lists what it holds. */
function skillRows(
  skills: SkillSetupEntry[],
  chosen: ReadonlySet<string>,
  onToggle: (ids: readonly string[], on: boolean) => void,
): SetupEntry[] {
  return groupSkills(skills).map((group) => {
    const ids = group.skills.map((skill) => skill.id);
    const on = ids.filter((id) => chosen.has(id)).length;
    const sole = group.skills[0] as SkillSetupEntry;
    return {
      identity: group.key,
      name: group.label,
      // A lone skill keeps its own description; a group reports how much of it is on.
      badge: isSkillCollection(group) ? `${on}/${ids.length} on` : sole.description || undefined,
      on: on === ids.length,
      // One target state for the whole group: off only once every member is on.
      onToggle: () => onToggle(ids, on !== ids.length),
    };
  });
}

/** One switch, wherever the dialog shows one: a capability row's and the footer's subagent
 *  flag are the same control, so both toggle the same way and announce the same name. */
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-on={on}
      onClick={onToggle}
      style={SWITCH_STYLE}
    />
  );
}

/** One switchable capability row. Each plugin, each skill collection and each MCP server
 *  render through the same markup so the picker cannot drift between the kinds. */
function SetupRow({
  name,
  badge,
  on,
  onToggle,
  striped,
}: {
  name: string;
  badge?: string;
  on: boolean;
  onToggle: () => void;
  striped?: boolean;
}) {
  return (
    <li style={{ ...ROW_STYLE, background: striped ? "var(--bg)" : "transparent" }}>
      <span style={ROW_TEXT_STACK}>
        <span className="mcp-setup-name" style={ROW_TEXT}>
          {name}
        </span>
        {badge ? (
          <span className="mcp-setup-badge" style={BADGE_STYLE}>
            {badge}
          </span>
        ) : null}
      </span>
      <Switch on={on} label={name} onToggle={onToggle} />
    </li>
  );
}
