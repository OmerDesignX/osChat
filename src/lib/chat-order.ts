import type { AiChatThread } from "../types";

function chatActivityTime(chat: Pick<AiChatThread, "updatedAt" | "createdAt">) {
  const updated = Date.parse(chat.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(chat.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function sortChatsByRecentActivity(chats: readonly AiChatThread[]) {
  return [...chats].sort(
    (left, right) =>
      chatActivityTime(right) - chatActivityTime(left) ||
      right.id.localeCompare(left.id),
  );
}
