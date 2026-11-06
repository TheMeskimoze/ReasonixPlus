import { createRoot } from "react-dom/client";
import { CapabilityDialog } from "./ui/mcp-setup";

const host = document.getElementById("root");
if (!host) throw new Error("#root missing");

createRoot(host).render(
  <CapabilityDialog
    title="Set up this chat"
    servers={[
      { name: "playwright", enabled: true, builtin: true },
      { name: "outlook_mail", enabled: true, builtin: false },
      { name: "unreal_mcp", enabled: true, builtin: false },
      { name: "blender", enabled: true, builtin: false },
      { name: "substance_painter", enabled: true, builtin: false },
      { name: "ghidra", enabled: true, builtin: false },
    ]}
    plugins={[{ name: "notfair", displayName: "NotFair", enabled: true }]}
    skills={[
      { id: "llmquant-commodities", description: "Commodities.", source: "https://github.com/LLMQuant/skills", enabled: true },
      { id: "llmquant-credit", description: "Credit.", source: "https://github.com/LLMQuant/skills", enabled: true },
      { id: "churn-analysis", description: "Predicts churn.", enabled: false },
    ]}
    subagents={false}
    confirmLabel="Confirm and start"
    dismissLabel="Cancel"
    onConfirm={() => {}}
    onCancel={() => {}}
  />,
);
