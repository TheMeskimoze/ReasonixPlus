import { t, useLang } from "../i18n";
import { I } from "../icons";
import { tabRunning } from "../live-rates";
import { ContextMenu, type ContextMenuItem } from "./file-menu";

export type ClearTabsScope = "all" | "right" | "left";

/** What a clear needs to know about a pill: its identity, and whether its agent runs. */
export interface ClearableTab {
  id: string;
  busy?: boolean;
}

export interface TabMenuProps {
  anchor: { x: number; y: number };
  /** The pills, each with the running flag a clear has to respect. */
  tabs: readonly ClearableTab[];
  activeId: string;
  /** The pill the menu was opened on, when it was opened on one: the menu can then
   *  offer to close exactly that tab. */
  targetId?: string;
  onCloseTab: (id: string) => void;
  onClear: (scope: ClearTabsScope) => void;
  onClose: () => void;
}

/**
 * Which tabs a clear scope reaches, before anything decides whether they may close:
 * - "all": every tab
 * - "right": all tabs to the right of the selected tab
 * - "left": all tabs to the left of the selected tab
 */
export function getTabsToClear<T extends { id: string }>(
  tabs: readonly T[],
  activeId: string,
  scope: ClearTabsScope,
): T[] {
  if (scope === "all") return [...tabs];
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  if (activeIndex === -1) return [];
  if (scope === "left") return tabs.slice(0, activeIndex);
  if (scope === "right") return tabs.slice(activeIndex + 1);
  return [];
}

/**
 * How a clear scope splits its tabs: the ones it may close, and the ones it must leave
 * because their agent is running. One rule for the close and for the count the ribbon
 * reports, so what a clear does and what it says it did cannot disagree.
 */
export function clearTabPartition<T extends ClearableTab>(
  tabs: readonly T[],
  activeId: string,
  scope: ClearTabsScope,
): { doomed: T[]; kept: T[] } {
  const doomed: T[] = [];
  const kept: T[] = [];
  for (const tab of getTabsToClear(tabs, activeId, scope)) {
    if (tabRunning(tab)) kept.push(tab);
    else doomed.push(tab);
  }
  return { doomed, kept };
}

/**
 * Dropdown context menu opened on right-clicking the tabs ribbon.
 * Offers closing the pill it was opened on, plus clearing every tab, the tabs to
 * the right, and the tabs to the left of the active one.
 */
export function TabMenu({
  anchor,
  tabs,
  activeId,
  targetId,
  onCloseTab,
  onClear,
  onClose,
}: TabMenuProps) {
  useLang();
  const scopeItems: { scope: ClearTabsScope; label: string; icon: React.ReactNode }[] = [
    { scope: "all", label: t("app.tab.clearAll"), icon: <I.x size={12} /> },
    { scope: "right", label: t("app.tab.clearRight"), icon: <I.chevR size={12} /> },
    { scope: "left", label: t("app.tab.clearLeft"), icon: <I.chevL size={12} /> },
  ];
  const items: ContextMenuItem[] = scopeItems.map((item) => {
    const { doomed, kept } = clearTabPartition(tabs, activeId, item.scope);
    // Nothing in reach: the item says so. Everything in reach is running, so the click
    // could only be refused: it names the way out instead of closing over the reason.
    const allRunning = doomed.length === 0 && kept.length > 0;
    return {
      key: item.scope,
      label: item.label,
      icon: item.icon,
      empty: doomed.length === 0 && kept.length === 0,
      disabled: allRunning,
      title: allRunning ? t("app.tab.clearIdleOnly") : undefined,
      onSelect: () => {
        onClear(item.scope);
        onClose();
      },
    };
  });
  if (targetId && tabs.some((tab) => tab.id === targetId)) {
    items.unshift({
      key: "close-tab",
      label: t("app.tab.close"),
      icon: <I.x size={12} />,
      onSelect: () => {
        onCloseTab(targetId);
        onClose();
      },
    });
  }

  return (
    <ContextMenu
      anchor={anchor}
      rootClass="file-menu tab-menu"
      itemClass="file-menu-item tab-menu-item"
      dismissSelector=".tab-menu"
      items={items}
      onClose={onClose}
    />
  );
}
