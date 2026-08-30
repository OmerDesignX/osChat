import type { AiChatMessage, AiChatThread } from "../types";

export type ChatCollectionApi = {
  createAiChat(title?: string): Promise<AiChatThread>;
  saveAiChat(
    id: string,
    messages: AiChatMessage[],
    contextSummary: string,
  ): Promise<AiChatThread>;
  updateAiChatMetadata(
    id: string,
    metadata: { title?: string; folder?: string; favorite?: boolean },
  ): Promise<AiChatThread>;
  deleteAiChat(id: string): Promise<boolean>;
};

function verifiedChat(chat: AiChatThread | null | undefined, id: string) {
  if (!chat || chat.id !== id) throw new Error("The chat change was not saved");
  return chat;
}

export async function patchChatCollection(
  api: ChatCollectionApi,
  chat: AiChatThread,
  patch: { title?: string; folder?: string; favorite?: boolean },
) {
  return verifiedChat(await api.updateAiChatMetadata(chat.id, patch), chat.id);
}

export async function duplicateChatCollection(
  api: ChatCollectionApi,
  chat: AiChatThread,
) {
  let created: AiChatThread | null = null;
  try {
    created = await api.createAiChat();
    verifiedChat(created, created.id);
    await api.saveAiChat(created.id, chat.messages, chat.contextSummary);
    return verifiedChat(
      await api.updateAiChatMetadata(created.id, {
        title: `${chat.title || "New chat"} copy`,
        folder: chat.folder,
        favorite: chat.favorite,
      }),
      created.id,
    );
  } catch (error) {
    if (created) await api.deleteAiChat(created.id).catch(() => false);
    throw error;
  }
}

export async function deleteChatCollection(
  api: ChatCollectionApi,
  chat: AiChatThread,
) {
  if (!(await api.deleteAiChat(chat.id)))
    throw new Error("The chat could not be deleted");
  return true;
}
