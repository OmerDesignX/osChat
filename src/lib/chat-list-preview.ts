const interactiveBlock = /```oschat-(?:artifact|widget)\b[\s\S]*?```/gi;
const unfinishedInteractiveBlock = /```oschat-(?:artifact|widget)\b[\s\S]*$/gi;

export function chatListPreview(content: string): string | null {
  const hasInteractiveBlock = /```oschat-(?:artifact|widget)\b/i.test(content);
  const publicText = content
    .replace(interactiveBlock, "")
    .replace(unfinishedInteractiveBlock, "")
    .replace(/\s+/g, " ")
    .trim();
  return hasInteractiveBlock && !publicText ? null : publicText;
}
