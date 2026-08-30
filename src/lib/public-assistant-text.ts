export function publicAssistantText(content: string) {
  return content
    .replace(/^(\s*(?:#{1,6}\s+)?)osCode\b(?=\s*[,.:!?—-]|\s)/i, "$1osChat")
    .replace(/\bI am osCode\b/gi, "I am osChat")
    .replace(/\bI'm osCode\b/gi, "I'm osChat")
    .replace(/\bidentify as osCode\b/gi, "identify as osChat")
    .replace(/\bAs osCode\b/gi, "As osChat")
    .replace(/\bosCode here\b/gi, "osChat here");
}
