import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const styles = read("src/styles.css");
const aiPanel = read("src/components/AiPanel.tsx");
const aiMessage = read("src/components/AiMessageContent.tsx");
const productivity = read("src/components/ProductivityWorkspaceV2.tsx");
const main = read("electron/main/index.ts");
const preload = read("electron/preload/index.cts");
const ai = read("electron/main/ai.ts");
const chatCollectionActions = read("src/lib/chat-collection-actions.ts");

test("AI work survives navigation, hidden windows, and renderer reattachment", () => {
  assert.doesNotMatch(
    main,
    /window\.on\("closed"[\s\S]{0,900}aiService\.stop\(\)/,
  );
  assert.match(
    main,
    /process\.platform === "darwin"[\s\S]*?event\.preventDefault\(\);[\s\S]*?window\.hide\(\)/,
  );
  assert.match(main, /async function persistAiResponse/);
  assert.match(main, /broadcastToAiProject\([\s\S]*?"ai:chat-complete"/);
  assert.match(main, /ipcMain\.handle\("ai:pipeline-current"/);
  assert.match(preload, /aiPipelineState: \(\) => ipcRenderer\.invoke/);
  assert.match(preload, /onAiChatComplete:/);
  assert.match(aiPanel, /window\.oscode[\s\S]{0,60}\.aiPipelineState\(\)/);
  assert.match(aiPanel, /window\.oscode\.onAiChatComplete/);
  assert.match(aiPanel, /pipelineState\.activeChatId === chatId/);
  assert.match(app, /const sharedAi = \(/);
  assert.match(app, /key="oschat-shared-ai"/);
  assert.match(app, /\{sharedAi\}/);
});

test("Intel CPU retry details never appear in public status text", () => {
  assert.doesNotMatch(ai, /Intel GPU startup failed/);
  assert.match(
    ai,
    /implementation detail out of the conversation status surface/,
  );
});

test("osChat uses the shared padded pill and circular action system", () => {
  assert.match(styles, /osChat rounded control system/);
  assert.match(styles, /--oschat-large-control-height: 54px/);
  assert.match(styles, /border-radius: var\(--oschat-pill-radius\)/);
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-composer-controls\.workspace/,
  );
  assert.match(
    styles,
    /grid-template-columns: minmax\(220px, 1fr\) minmax\(220px, 1fr\) auto/,
  );
  assert.match(aiPanel, /<FeatherIcon icon="cpu" size="18" \/>/);
});

test("osChat uses a chat-first shell with familiar left navigation", () => {
  assert.match(app, /className="oschat-sidebar"/);
  assert.match(app, /className="new-chat-button"/);
  assert.match(app, /Search chats and workspaces/);
  assert.match(app, /Recent chats/);
  assert.match(app, />\s*Notes\s*</);
  assert.match(app, /notes-kind-nav/);
  assert.match(app, /OsChatWordmark/);
  assert.match(app, /mac-titlebar-safe-area/);
  assert.match(app, /data-oschat-ready="true"/);
  assert.match(
    styles,
    /grid-template-columns: var\(--oschat-sidebar-width\) minmax\(0, 1fr\)/,
  );
});

test("documents, spreadsheets, and presentations are first-class workspaces", () => {
  assert.match(app, /document: "Documents"/);
  assert.match(app, /spreadsheet: "Spreadsheets"/);
  assert.match(app, /presentation: "Presentations"/);
  assert.match(productivity, /function DocumentEditor/);
  assert.match(productivity, /function SpreadsheetEditor/);
  assert.match(productivity, /function PresentationEditor/);
  assert.match(productivity, /className="export-menu"/);
  assert.match(productivity, /Word document \(\.docx\)/);
  assert.match(productivity, /Workbook \(\.xlsx\)/);
  assert.match(productivity, /Presentation \(\.pptx\)/);
  assert.match(productivity, /=SUM\(A1:A8\)/);
  assert.match(productivity, /Speaker notes/);
  assert.match(productivity, /Present/);
});

test("productivity workspaces autosave and expose organized item metadata", () => {
  assert.match(productivity, /All changes saved automatically/);
  assert.match(chatCollectionActions, /updateAiChatMetadata/);
  assert.match(chatCollectionActions, /deleteAiChat/);
  assert.match(app, /favorite/);
  assert.match(app, /folder/);
  assert.match(app, /New folder/);
  assert.match(app, /const openChatAction =/);
  assert.match(app, /"Rename chat"/);
  assert.match(app, /title: value\.slice\(0, 120\)/);
  assert.match(app, /icon="edit-3" size="15" \/> Rename/);
  assert.match(app, /toggleChatFavorite/);
  assert.match(app, /className="chat-favorite-toggle"/);
  assert.match(app, /Remove .* from favorites/);
  assert.match(styles, /\.chat-favorite-toggle/);
  assert.match(app, /duplicateChatCollection/);
  assert.match(app, /openChatAction\("delete", chat\)/);
  assert.match(app, /chat-action-dialog/);
  assert.match(app, /Duplicate/);
  assert.match(app, /Move to\s+folder/);
  assert.match(app, /createPortal/);
  assert.match(styles, /sidebar-item-menu-portal/);
});

test("document, sheet, and presentation controls use organized ribbons", () => {
  assert.match(productivity, /const RibbonTabs/);
  assert.match(productivity, /label="Document tools"/);
  assert.match(productivity, /label="Spreadsheet tools"/);
  assert.match(productivity, /label="Presentation tools"/);
  assert.match(productivity, /className="toolbar-row horizontal-menu-scroll"/);
  assert.match(styles, /\.productivity-ribbon-tabs/);
  assert.match(styles, /\.productivity-toolbar\.ribbon-toolbar/);
});

test("presentations support draggable slides and editable visual objects", () => {
  assert.match(productivity, /draggable/);
  assert.match(productivity, /dataTransfer\.setData\("text\/slide-id"/);
  assert.match(productivity, /beginDrag/);
  assert.match(productivity, /Text box/);
  assert.match(productivity, /Rectangle/);
  assert.match(productivity, /Circle/);
  assert.match(productivity, /Line/);
  assert.match(productivity, /Choose an image/);
  assert.match(productivity, /readAsDataURL/);
  assert.match(productivity, /beginResize/);
  assert.match(productivity, /slide-resize-handle/);
  assert.match(productivity, /Bring to front/);
  assert.match(productivity, /Copy slide/);
  assert.match(productivity, /Paste slide/);
  assert.match(productivity, /Move earlier/);
  assert.match(productivity, /Move later/);
  assert.match(main, /deck\.ShapeType\.ellipse/);
  assert.match(main, /slide\.addImage/);
});

test("notifications are a real history panel and AI controls share the top bar", () => {
  assert.match(app, /id="oschat-ai-controls"/);
  assert.match(app, /className="oschat-top-divider"/);
  assert.match(app, /className="oschat-notification-panel"/);
  assert.match(app, />\s*Clear\s*<\/button>/);
  assert.match(app, /controlsPortalId="oschat-ai-controls"/);
  assert.match(aiPanel, /createPortal\(headActions, controlsTarget\)/);
  assert.match(app, /readAt\?: string/);
  assert.match(app, /unreadNotificationCount/);
  assert.match(app, /markVisibleChatRead/);
  assert.match(app, /clearReadNotifications/);
  assert.match(app, /document\.visibilityState === "visible"/);
  assert.match(app, /window\.addEventListener\("focus"/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(aiPanel, /chatId: executionChatId/);
  assert.match(app, /title: "Permission required"/);
  assert.match(app, /title: "Input required"/);
  assert.match(app, /title: "Complete"/);
  assert.match(app, /title: "Stopped"/);
  assert.match(app, /title: "Failed"/);
  assert.doesNotMatch(app, /osChat needs you/);
});

test("chat and notes use separate functional in-app folder scopes", () => {
  assert.match(app, /type FolderScope = "chat" \| "notes"/);
  assert.match(app, /oschat-folder-scopes-v2/);
  assert.match(app, /folderScope: FolderScope = view === "chat"/);
  assert.match(app, /savedFolderScopes\[folderScope\]/);
  assert.match(app, /className="folder-create-form"/);
  assert.match(app, /onSubmit=\{createFolder\}/);
  assert.doesNotMatch(app, /globalThis\.prompt\("New folder name"/);
  assert.match(styles, /\.folder-create-form \{/);
  assert.match(
    styles,
    /\.collection-browser > \.folder-strip small \{[\s\S]*?font-size: 12px;/,
  );
});

test("model reasoning and compact actions use readable text and padding", () => {
  assert.match(aiPanel, /publicAssistantText/);
  assert.match(aiPanel, /content=\{publicAssistantText\(message\.thinking\)\}/);
  assert.match(
    styles,
    /\.ai-message \.ai-reasoning > summary,[\s\S]*?min-height: 48px;[\s\S]*?padding: 11px 14px;[\s\S]*?font-size: 14px !important/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-message \.ai-reasoning > \.ai-message-rich-content \{[\s\S]*?padding: var\(--oschat-content-pad-block\) var\(--oschat-content-pad-inline\)/,
  );
  assert.match(
    styles,
    /\.ai-reasoning[\s\S]*?> \.ai-message-rich-content[\s\S]*?> \.ai-message-content \{[\s\S]*?padding: 0 !important;/,
  );
  assert.match(
    styles,
    /\.ai-message \.ai-action-timeline\.compact \.ai-action-card \{[\s\S]*?padding: 11px 12px/,
  );
  assert.match(styles, /--oschat-body-text-size: 14px/);
  assert.match(
    styles,
    /\.oschat-app small,[\s\S]*?\.oschat-app \.notification-list article p,[\s\S]*?font-size: var\(--oschat-body-text-size\) !important/,
  );
  assert.match(app, /publicAssistantText\(item\.detail\)/);
  assert.match(
    app,
    /publicAssistantText\([\s\S]*?chat\.messages\.at\(-1\)\?\.content/,
  );
});

test("workspace chat controls sit above the composer without a panel strip", () => {
  assert.match(aiPanel, /className="ai-empty-brand" aria-label="osChat"/);
  assert.match(aiPanel, /<span>os<\/span>[\s\S]*?<strong>Chat<\/strong>/);
  assert.match(aiPanel, /Let’s build things…/);
  assert.match(
    aiPanel,
    /className={`ai-composer-controls\$\{workspaceMode \? " workspace" : ""\}`}/,
  );
  assert.match(
    aiPanel,
    /renderModelToggle\("ai-workspace-model-size-picker"\)/,
  );
  assert.match(aiPanel, /className="ai-inline-goal"/);
  assert.match(aiPanel, /Goal for this chat/);
  assert.match(aiPanel, /!workspaceMode &&[\s\S]*?workspaceOpen &&/);
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-composer-controls\.workspace \{[\s\S]*?background: transparent;/,
  );
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-composer-controls \.ai-tier-toggle \{[\s\S]*?order: 1;[\s\S]*?max-width: 230px;/,
  );
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-inline-goal \{[\s\S]*?order: 2;/,
  );
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-composer-controls \.ai-capability-drawer \{[\s\S]*?order: 3;/,
  );
  assert.match(
    styles,
    /--oschat-content-pad-block: clamp\(12px, 1vw, 16px\);[\s\S]*?--oschat-content-pad-inline: clamp\(14px, 1\.4vw, 18px\);/,
  );
});

test("new chat refreshes and opens an empty conversation immediately", () => {
  assert.match(
    app,
    /new CustomEvent\("oscode:open-ai-chat", \{ detail: chat\.id \}\)/,
  );
  assert.match(
    aiPanel,
    /const next = await refreshAgentState\(\);[\s\S]*?next\.chats\.find\(\(item\) => item\.id === openChatId\)/,
  );
  assert.match(
    aiPanel,
    /setMessages\(cleanMessages\);[\s\S]*?setInput\(""\);[\s\S]*?setAttachments\(\[\]\);/,
  );
});

test("productivity artifacts are private, bounded, atomic, and recoverably deleted", () => {
  assert.match(main, /chatWorkspaceRoot\(\)/);
  assert.match(main, /20 \* 1024 \* 1024/);
  assert.match(main, /fs\.writeFile\(temporary, json/);
  assert.match(main, /fs\.rename\(temporary, target\)/);
  assert.match(main, /shell\.trashItem\(artifactFile/);
  assert.match(main, /Move artifact to Trash/);
  assert.match(preload, /workspace:ensure/);
  assert.match(preload, /artifact:save/);
  assert.match(preload, /artifact:export/);
});

test("native productivity exports use DOCX, XLSX, and PPTX libraries", () => {
  assert.match(main, /await import\("docx"\)/);
  assert.match(main, /await import\("xlsx"\)/);
  assert.match(main, /await import\("pptxgenjs"\)/);
  assert.match(main, /Packer\.toBuffer/);
  assert.match(main, /XLSX\.writeFile/);
  assert.match(main, /deck\.writeFile/);
});

test("the same AI collaborator powers chat and productivity without developer terminal chrome", () => {
  assert.match(app, /const sharedAi = \(/);
  assert.match(app, /key="oschat-shared-ai"/);
  assert.match(app, /workspaceMode/);
  assert.match(app, /hideTerminalControl/);
  assert.match(app, /assistantName="osChat"/);
  assert.match(app, /\{sharedAi\}\s*<\/main>/);
  assert.doesNotMatch(
    app,
    /<aside className="artifact-ai-pane"[\s\S]*?\{sharedAi\}/,
  );
  assert.doesNotMatch(app, /TerminalPanel/);
  assert.match(aiPanel, /\{!hideTerminalControl && \(/);
});

test("one persistent chat pipeline survives navigation and queues follow-ups", () => {
  assert.match(app, /key="oschat-shared-ai"/);
  assert.match(aiPanel, /if \(busy\) \{[\s\S]*?addAiQueue\(chatId, text\)/);
  assert.match(aiPanel, /const executionChatId = chatIdRef\.current/);
  assert.match(aiPanel, /chatIdRef\.current === executionChatId/);
  assert.match(aiPanel, /const runNextQueued = async/);
  assert.match(aiPanel, /nextState\.queue\.find/);
  assert.match(aiPanel, /runBackgroundQueued\(nextChat, next/);
});

test("desktop shell exposes one main workspace window", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /if \(mainWindow && !mainWindow\.isDestroyed\(\)\)/);
  assert.doesNotMatch(main, /label: "New Window"/);
  assert.doesNotMatch(main, /file-new-window/);
  assert.match(
    main,
    /let aiExecutionTail: Promise<void> = Promise\.resolve\(\)/,
  );
  assert.match(main, /const run = aiExecutionTail\.then/);
});

test("model settings preserve verified tiers and custom local runtimes", () => {
  assert.match(app, /\["small", "medium", "large"\]/);
  assert.match(app, /downloadOsCodeModel/);
  assert.match(app, /GGUF/);
  assert.match(app, /MLX/);
  assert.match(app, /PyTorch/);
  assert.match(app, /Ollama/);
  assert.match(aiPanel, /Choose a local model/);
  assert.match(aiPanel, /Add custom model/);
});

test("permissions remain visible, scoped, and available above the composer", () => {
  assert.match(app, /Files and artifacts/);
  assert.match(app, /Public web research/);
  assert.match(app, /Agent browser/);
  assert.match(app, /Computer Control/);
  assert.match(aiPanel, /Agent permissions/);
  assert.match(
    aiPanel,
    /createPortal\([\s\S]*?ai-capability-popover-layer[\s\S]*?document\.body/,
  );
  assert.match(aiPanel, /Choose what osChat can use in this chat/);
  assert.match(
    styles,
    /\.ai-capability-bar\.ai-capability-popover \{[\s\S]*?position: fixed !important;/,
  );
  assert.match(
    styles,
    /\.ai-capability-popover \.ai-capability-grid \{[\s\S]*?grid-template-columns: repeat\(2,/,
  );
  assert.match(aiPanel, /Run terminal commands/);
  assert.match(aiPanel, /grantAiPermission/);
});

test("chat can render inert interactive artifacts and opens editable workspaces", () => {
  assert.match(aiMessage, /oschat-\(\?:artifact\|widget\)/);
  assert.match(aiMessage, /ChatArtifactPayload/);
  assert.match(aiMessage, /chat-artifact-table-wrap/);
  assert.match(aiMessage, /chat-artifact-chart/);
  assert.match(aiMessage, /tableQuery/);
  assert.match(aiMessage, /sortColumn/);
  assert.match(aiMessage, /ai-source-list/);
  assert.match(aiMessage, /ai-web-link-mark/);
  assert.match(aiMessage, /websiteIcon/);
  assert.match(aiMessage, /ai-web-link-icon/);
  assert.match(aiMessage, /referrerpolicy/);
  assert.match(aiMessage, /document\.querySelectorAll\("table"\)/);
  assert.match(aiMessage, /Open workspace/);
  assert.match(aiMessage, /DOMPurify\.sanitize/);
  assert.match(aiMessage, /FORBID_TAGS/);
  assert.match(aiMessage, /window\.oscode\.openExternalUrl/);
  assert.match(app, /onOpenArtifact/);
});

test("the local agent prompt understands osChat artifacts and still acts through tools", () => {
  assert.match(ai, /You are osChat's private local agentic assistant/);
  assert.match(ai, /APP IDENTITY \(highest priority\)/);
  assert.match(ai, /Never call yourself osCode/);
  assert.match(ai, /PRODUCTIVITY WORKSPACES/);
  assert.match(ai, /\.oschat\.json/);
  assert.match(ai, /INTERACTIVE CHAT/);
  assert.match(ai, /INTERACTIVE CHAT COMPLETION CONTRACT/);
  assert.match(ai, /every substantive answer MUST include exactly one/);
  assert.match(ai, /Saving an \.oschat\.json file is internal persistence/);
  assert.match(ai, /Interactive-output correction/);
  assert.match(ai, /hasRenderableInteractiveContent/);
  assert.match(ai, /fallbackInteractiveContent/);
  assert.match(ai, /call write_file with complete content/);
  assert.match(ai, /Never derive or enrich a web query/);
  assert.match(ai, /PROMPT-INJECTION RULE/);
});

test("responsive layouts scroll dense horizontal menus rather than crushing controls", () => {
  assert.match(app, /data-horizontal-menu/);
  assert.match(app, /scrollHorizontalMenu/);
  assert.match(productivity, /horizontal-menu-scroll/);
  assert.match(styles, /\.productivity-toolbar[\s\S]*overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 860px\)/);
  assert.match(styles, /@media \(max-width: 660px\)/);
  assert.match(aiPanel, /conversation\.scrollTo/);
  assert.match(aiPanel, /event\.deltaY < 0/);
  assert.match(styles, /overscroll-behavior-y: contain/);
});

test("gunmetal, deep-blue, and paper themes retain the baby-blue accent", () => {
  assert.match(styles, /--bg: #171819/);
  assert.match(styles, /--baby-200: #89cff0/);
  assert.match(styles, /--selector-active-bg: #304752/);
  assert.match(styles, /--selector-active-bg: #183654/);
  assert.match(styles, /--selector-active-bg: #c9e0f2/);
  assert.match(
    styles,
    /\.collection-tabs button\.active,[\s\S]*?border: 0;[\s\S]*?background: var\(--selector-active-bg\)/,
  );
  assert.match(app, /Gunmetal/);
  assert.match(app, /Deep blue/);
  assert.match(app, /Paper light/);
  assert.match(app, /theme === "dark" \? "" : theme/);
});

test("update UI appears only for a real available or ready package", () => {
  assert.match(
    app,
    /\["available", "ready"\]\.includes\(updateStatus\.state\)/,
  );
  assert.match(app, /Update available/);
  assert.match(app, /installAppUpdate/);
  assert.match(app, /setAppAutoUpdate/);
  assert.doesNotMatch(app, /state === "idle"[\s\S]{0,80}Update available/);
});

test("Computer Control keeps a persistent blue banner and red emergency stop", () => {
  assert.match(app, /Computer Control active/);
  assert.match(app, /Press <kbd>Esc<\/kbd> anywhere to stop/);
  assert.match(app, /stopAgentControl/);
  assert.match(styles, /\.oschat-control-banner/);
  assert.match(styles, /background: #852a35/);
});

test("settings use one consolidated, balanced panel system", () => {
  assert.match(app, /className="oschat-settings"/);
  assert.match(app, /Appearance/);
  assert.match(app, /Models/);
  assert.match(app, /Permissions/);
  assert.match(
    styles,
    /\.oschat-main\.chat-view\s+\.ai-capability-bar\.ai-capability-popover\s*\{[\s\S]*?flex-direction:\s*column\s*!important;[\s\S]*?overflow:\s*hidden\s*!important;/,
  );
  assert.match(
    aiPanel,
    /document\.querySelector\("\.oschat-app"\) \|\| document\.body/,
  );
  assert.match(
    styles,
    /\.oschat-app\s*>\s*\.ai-capability-popover-layer[\s\S]*?background:\s*var\(--overlay-surface\)\s*!important;/,
  );
  assert.match(
    styles,
    /\.ai-capability-bar\.ai-capability-popover[\s\S]*?>\s*\.ai-capability-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(app, /Updates/);
  assert.match(app, /Data & privacy/);
  assert.match(styles, /width: min\(1020px, 96vw\)/);
  assert.match(styles, /grid-template-columns: 230px minmax\(0, 1fr\)/);
});

test("osCode polish is shared by chat lists, utility panels, and composer actions", () => {
  assert.match(styles, /osCode polish pass/);
  assert.match(
    styles,
    /\.oschat-main\.chat-view \.ai-composer \{[\s\S]*?align-items: center/,
  );
  assert.match(
    styles,
    /\.sidebar-list > div \{[\s\S]*?gap: 10px;[\s\S]*?padding: 4px 2px 12px/,
  );
  assert.match(
    styles,
    /\.oschat-settings > aside header \.oschat-wordmark,[\s\S]*?"Playfair Display"/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-activity-popover[\s\S]*?border-radius: var\(--oschat-panel-radius\)/,
  );
  assert.match(styles, /\.oschat-app \.ai-action-timeline \{[\s\S]*?gap: 10px/);
});

test("long AI panels keep opaque headers fixed above one padded scroll body", () => {
  assert.match(aiPanel, /className="ai-activity-body"/);
  assert.match(aiPanel, /className="ai-permission-body"/);
  assert.match(styles, /Final panel scroll contract/);
  assert.match(
    styles,
    /> \.ai-history-title \{[\s\S]*?position: relative;[\s\S]*?background: var\(--overlay-surface\) !important;/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-activity-body,[\s\S]*?\.oschat-app \.ai-permission-body \{[\s\S]*?overflow-y: auto;/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-model-popover \.ai-model-manager \{[\s\S]*?max-height: none !important;[\s\S]*?padding: 20px 20px 38px;[\s\S]*?overflow-y: auto;/,
  );
});

test("dropdowns, color swatches, permissions, and model lists share one inset rhythm", () => {
  assert.match(
    styles,
    /\.oschat-app select \{[\s\S]*?padding: 0 52px 0 18px !important;[\s\S]*?appearance: none !important;[\s\S]*?background-position:/,
  );
  assert.match(
    styles,
    /\.oschat-app input\[type="color"\] \{[\s\S]*?border-radius: 50% !important;/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-permission-body \.ai-permission-row \{[\s\S]*?min-height: 66px;[\s\S]*?border-radius: 22px;/,
  );
  assert.match(
    styles,
    /\.oschat-app \.ai-model-popover \.ai-model-table \{[\s\S]*?display: grid;[\s\S]*?gap: 10px;/,
  );
  assert.match(
    styles,
    /\.oschat-app \.settings-model-list \{[\s\S]*?gap: 10px;/,
  );
});
