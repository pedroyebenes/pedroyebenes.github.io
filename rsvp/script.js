// ============================================================================
// CONSTANTS
// ============================================================================

const SHORT_WORD_MAX = 2; // Maximum length for word pairing (2 pairs "of a", "to be", "in it")
const WPM_MIN = 100;
const WPM_MAX = 900;
const WPM_DEFAULT = 350;
const WPM_STEP = 10;

// Timing constants (milliseconds)
const PAUSE_SENTENCE_END = 220;  // After . ! ?
const PAUSE_COMMA_SEMICOLON = 120;  // After , ; : —
const BONUS_LONG_WORD_12 = 120;  // Words 12+ chars
const BONUS_LONG_WORD_9 = 70;   // Words 9-11 chars

// ORP (Optimal Reading Position) thresholds
const ORP_THRESHOLDS = [1, 5, 9, 13]; // Word length thresholds for ORP index

// ============================================================================
// DOM ELEMENT REFERENCES
// ============================================================================

// RSVP display elements
const editor = document.getElementById("editor");
const stageEl = document.getElementById("stage");
const wordEl = document.getElementById("word");
const idxLabel = document.getElementById("idxLabel");
const totalLabel = document.getElementById("totalLabel");
const statusPill = document.getElementById("statusPill");
const footerHint = document.getElementById("footerHint");
const anchorGuide = document.getElementById("anchorGuide");

// Control inputs
const wpmRange = document.getElementById("wpmRange");
const wpmNum = document.getElementById("wpmNum");
const smartPausesBox = document.getElementById("smartPauses");
const showGuideBox = document.getElementById("showGuide");
const pairShortWordsBox = document.getElementById("pairShortWords");

// Navigation buttons
const toggleTextBtn = document.getElementById("toggleTextBtn");
const rewindBtn = document.getElementById("rewindBtn");
const backBtn = document.getElementById("backBtn");
const forwardBtn = document.getElementById("forwardBtn");
const resetBtn = document.getElementById("resetBtn");

// Chapter controls
const chapterChip = document.getElementById("chapterChip");
const prevChapterBtn = document.getElementById("prevChapterBtn");
const nextChapterBtn = document.getElementById("nextChapterBtn");

// EPUB import elements
const epubFile = document.getElementById("epubFile");
const epubMeta = document.getElementById("epubMeta");
const epubError = document.getElementById("epubError");
const chapterList = document.getElementById("chapterList");
const chapCount = document.getElementById("chapCount");
const bookDropdown = document.getElementById("bookDropdown");
const clearBtn = document.getElementById("clearBtn");
const importFile = document.getElementById("importFile");
const importUrl = document.getElementById("importUrl");
const epubUrl = document.getElementById("epubUrl");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const importModeRadios = document.querySelectorAll('input[name="importMode"]');

// ============================================================================
// STATE
// ============================================================================

let tokens = [];
let idx = 0;
let isHeld = false;
let timerId = null;
let spaceDown = false; // Prevents Space auto-repeat from restarting

// Chapter/book state
let currentBook = null;           // { title, author, chapters:[{title,text}] }
let currentChapterIndex = -1;     // -1 when not loaded from EPUB
let currentSourceKey = "";         // "upload:...", "url:...", or "books:..."

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Tokenizes text into words with their start/end positions
 */
function tokenizeWithOffsets(text) {
  const tokens = [];
  const wordRegex = /\S+/g;
  let match;
  
  while ((match = wordRegex.exec(text)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return tokens;
}

/**
 * Finds the token index that contains or is closest to the caret position
 */
function tokenIndexFromCaret(tokens, caretPos) {
  if (!tokens.length) return 0;
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (caretPos >= token.start && caretPos < token.end) return i;
    if (caretPos < token.start) return i;
  }
  
  return tokens.length - 1;
}

/**
 * Calculates the Optimal Reading Position (ORP) index for a word
 * ORP is typically around 1/3 into the word
 */
function orpIndex(word) {
  const len = word.length;
  if (len <= ORP_THRESHOLDS[0]) return 0;
  if (len <= ORP_THRESHOLDS[1]) return 1;
  if (len <= ORP_THRESHOLDS[2]) return 2;
  if (len <= ORP_THRESHOLDS[3]) return 3;
  return 4;
}

/**
 * Calculates base milliseconds per word based on WPM
 */
function baseMsPerWord(wpm) {
  return 60000 / Math.max(1, wpm);
}

/**
 * Calculates extra pause time for punctuation (smart pauses)
 */
function extraPauseMs(tokenValue, smart) {
  if (!smart) return 0;
  
  // Sentence-ending punctuation
  if (/[.?!]["')\]]?$/.test(tokenValue)) return PAUSE_SENTENCE_END;
  
  // Comma, semicolon, colon, em-dash
  if (/[,;:]["')\]]?$/.test(tokenValue)) return PAUSE_COMMA_SEMICOLON;
  if (/—$/.test(tokenValue)) return PAUSE_COMMA_SEMICOLON;
  
  return 0;
}

/**
 * Calculates bonus time for long words (smart pauses)
 */
function longWordBonusMs(tokenValue, smart) {
  if (!smart) return 0;
  
  // Strip edge punctuation to get actual word length
  const bare = tokenValue.replace(/^[("'\[]+|[)"'\].,;:!?]+$/g, "");
  const len = bare.length;
  
  if (len >= 12) return BONUS_LONG_WORD_12;
  if (len >= 9) return BONUS_LONG_WORD_9;
  
  return 0;
}

/**
 * Measures text width in pixels using canvas
 */
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

function measureTextPx(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(str) {
  const htmlEscapes = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

/**
 * Builds HTML for word display with ORP highlighting
 */
function buildWordHTML(tokenValue, anchorIdx) {
  const pre = tokenValue.slice(0, anchorIdx);
  const char = tokenValue.charAt(anchorIdx) || "";
  const post = tokenValue.slice(anchorIdx + 1);
  
  return `<span class="pre">${escapeHtml(pre)}</span>` +
         `<span class="orp">${escapeHtml(char)}</span>` +
         `<span class="post">${escapeHtml(post)}</span>`;
}

/**
 * Positions word element so the ORP character aligns with the anchor guide
 */
function positionWordAtAnchor(wordEl, tokenValue, anchorIdx) {
  const style = getComputedStyle(wordEl);
  const { fontFamily, fontSize, fontStyle, fontVariant, lineHeight } = style;
  
  const fontNormal = `${fontStyle} ${fontVariant} 400 ${fontSize} / ${lineHeight} ${fontFamily}`;
  const fontBold = `${fontStyle} ${fontVariant} 800 ${fontSize} / ${lineHeight} ${fontFamily}`;
  
  const pre = tokenValue.slice(0, anchorIdx);
  const char = tokenValue.charAt(anchorIdx) || "";
  
  const preWidth = measureTextPx(pre, fontNormal);
  const charWidth = measureTextPx(char, fontBold);
  const shiftX = preWidth + (charWidth / 2);
  
  wordEl.style.transform = `translate(${-shiftX}px, -50%)`;
}

// ============================================================================
// WORD PAIRING (Short Word Bundling)
// ============================================================================

/**
 * Strips punctuation from the edges of a word
 */
function stripEdgePunct(str) {
  return str.replace(/^[("'\[]+|[)"'\].,;:!?]+$/g, "");
}

/**
 * Checks if a word ends with punctuation that indicates a pause/boundary
 */
function endsWithPausePunct(str) {
  return /[.?!,;:]["')\]]?$/.test(str);
}

/**
 * Checks if a word is considered "short" for pairing purposes
 */
function isShortWord(str) {
  const bare = stripEdgePunct(str);
  return bare.length > 0 && bare.length <= SHORT_WORD_MAX;
}

/**
 * Gets the display bundle for the current token index
 * Returns { text: string, advanceBy: number }
 * When pairing is enabled, short words are combined (e.g., "of a", "to be")
 */
function getDisplayBundle(index) {
  if (!tokens.length) {
    return { text: "", advanceBy: 1 };
  }

  const token0 = tokens[index]?.value ?? "";
  
  // If pairing is disabled or we're at the last token, return single word
  if (!pairShortWordsBox.checked || index >= tokens.length - 1) {
    return { text: token0, advanceBy: 1 };
  }

  const token1 = tokens[index + 1]?.value ?? "";
  
  // Pair only if both are short words and token0 doesn't end with pause punctuation
  if (isShortWord(token0) && isShortWord(token1) && !endsWithPausePunct(token0)) {
    return { text: `${token0} ${token1}`, advanceBy: 2 };
  }
  
  return { text: token0, advanceBy: 1 };
}

// ============================================================================
// RSVP CORE - Token Management & Display
// ============================================================================

/**
 * Refreshes tokens from editor content and updates index from cursor position
 */
function refreshTokensAndIndexFromCursor() {
  tokens = tokenizeWithOffsets(editor.value);
  totalLabel.textContent = String(tokens.length);
  
  const caret = editor.selectionStart ?? 0;
  idx = tokenIndexFromCaret(tokens, caret);
  
  renderCurrent();
  updateChapterButtons();
}

/**
 * Renders the current word/bundle in the RSVP display
 */
function renderCurrent() {
  if (!tokens.length) {
    wordEl.innerHTML = `<span class="pre"></span><span class="orp"></span><span class="post"></span>`;
    idxLabel.textContent = "0";
    return;
  }

  // Clamp index to valid range
  idx = Math.max(0, Math.min(idx, tokens.length - 1));

  const bundle = getDisplayBundle(idx);
  const displayText = bundle.text;

  // Calculate ORP anchor position
  const bare = stripEdgePunct(displayText);
  const bareStart = displayText.indexOf(bare);
  const anchorInBare = orpIndex(bare);
  const anchor = Math.max(0, Math.min(displayText.length - 1, bareStart + anchorInBare));

  // Update display
  wordEl.innerHTML = buildWordHTML(displayText, anchor);
  positionWordAtAnchor(wordEl, displayText, anchor);
  idxLabel.textContent = String(idx + 1);
}

/**
 * Steps forward to the next word/bundle
 */
function stepForward() {
  if (!tokens.length) return;
  
  const bundle = getDisplayBundle(idx);
  idx = Math.min(tokens.length - 1, idx + bundle.advanceBy);
  
  renderCurrent();
  updateChapterButtons();
}

/**
 * Steps backward by one word (always 1, not bundle size, for intuitive behavior)
 */
function stepBack() {
  if (!tokens.length) return;
  
  idx = Math.max(0, idx - 1);
  renderCurrent();
  updateChapterButtons();
}

/**
 * Rewinds by n words
 */
function rewind(n) {
  if (!tokens.length) return;
  
  idx = Math.max(0, idx - n);
  renderCurrent();
  updateChapterButtons();
}

/**
 * Gets current WPM value
 */
function getWPM() {
  return Number(wpmNum.value) || WPM_DEFAULT;
}

/**
 * Synchronizes WPM range and number inputs
 */
function syncWpmInputs(source) {
  const value = Math.max(WPM_MIN, Math.min(WPM_MAX, Number(source.value) || WPM_DEFAULT));
  wpmRange.value = String(value);
  wpmNum.value = String(value);
}

/**
 * Checks if we're at the end of the current chapter
 */
function isAtEndOfChapter() {
  return tokens.length > 0 && idx >= tokens.length - 1;
}

/**
 * Moves the text editor caret to the current token position
 */
function moveCaretToCurrentToken() {
  editor.focus({ preventScroll: true });

  // If at end, place caret at end of text
  if (isAtEndOfChapter()) {
    const endPos = editor.value.length;
    editor.setSelectionRange(endPos, endPos);
    editor.scrollTop = editor.scrollHeight;
    return;
  }

  // Otherwise place caret at start of current token
  if (!tokens.length) return;
  
  const token = tokens[Math.max(0, Math.min(idx, tokens.length - 1))];
  const pos = token.start;
  editor.setSelectionRange(pos, pos);

  // Scroll to keep caret visible (rough approximation)
  const before = editor.value.slice(0, pos);
  const lineCount = before.split("\n").length - 1;
  const approxLineHeight = 20;
  const targetY = Math.max(0, (lineCount * approxLineHeight) - editor.clientHeight / 3);
  editor.scrollTop = targetY;
}


// ============================================================================
// RSVP CORE - Playback Control
// ============================================================================

/**
 * Schedules the next word display tick based on timing calculations
 */
function scheduleNextTick() {
  clearTimeout(timerId);
  timerId = null;
  
  if (!isHeld || !tokens.length) return;

  const wpm = getWPM();
  const smart = smartPausesBox.checked;
  const bundle = getDisplayBundle(idx);
  const displayText = bundle.text;

  // Calculate timing: base + punctuation pauses + long word bonus
  let ms = baseMsPerWord(wpm);
  ms += extraPauseMs(displayText, smart);
  ms += longWordBonusMs(displayText, smart);

  timerId = setTimeout(() => {
    if (!isHeld) return;

    const advanceBy = getDisplayBundle(idx).advanceBy;
    const nextIdx = idx + advanceBy;

    if (nextIdx <= tokens.length - 1) {
      idx = Math.min(tokens.length - 1, nextIdx);
      renderCurrent();
      updateChapterButtons();

      // If we just landed on the last token, stop playback
      if (idx >= tokens.length - 1) {
        setHeld(false, { reason: "end" });
        return;
      }

      scheduleNextTick();
    } else {
      setHeld(false, { reason: "end" });
    }
  }, ms);
}

/**
 * Sets the held/playing state and updates UI accordingly
 * @param {boolean} held - Whether playback should be active
 * @param {Object} meta - Metadata about the state change (e.g., { reason: "release" | "end" })
 */
function setHeld(held, meta = {}) {
  const wasHeld = isHeld;
  isHeld = held;

  // Update status pill
  statusPill.textContent = held ? "Playing (held)" : "Paused";
  statusPill.style.borderColor = held 
    ? "rgba(92,200,255,0.5)" 
    : "rgba(255,255,255,0.08)";

  if (held) {
    scheduleNextTick();
  } else {
    clearTimeout(timerId);
    timerId = null;
    
    // Only jump caret on release (not when ending naturally)
    if (wasHeld && meta.reason === "release") {
      moveCaretToCurrentToken();
    }
    
    updateChapterButtons();
  }
}

// ============================================================================
// LAYOUT & RESPONSIVE HELPERS
// ============================================================================

/**
 * Checks if the viewport is phone-sized
 */
function isPhone() {
  return window.matchMedia("(max-width: 920px)").matches;
}

/**
 * Checks if the device uses touch input
 */
function touchMode() {
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Shows RSVP view on phone (hides text panel)
 */
function showRSVPPhone() {
  document.body.classList.remove("phoneShowText");
  document.body.classList.add("phoneShowRSVP");
  toggleTextBtn.textContent = "Show text";
}

/**
 * Shows text view on phone (hides RSVP panel)
 */
function showTextPhone() {
  document.body.classList.remove("phoneShowRSVP");
  document.body.classList.add("phoneShowText");
  toggleTextBtn.textContent = "Hide text";
}

/**
 * Toggles text panel visibility on desktop
 */
function setDesktopTextHidden(hidden) {
  document.body.classList.toggle("textHidden", hidden);
  toggleTextBtn.textContent = hidden ? "Show text" : "Hide text";
}

/**
 * Updates footer hint based on input mode (touch vs keyboard)
 */
function updateFooterHint() {
  if (touchMode()) {
    footerHint.textContent = "Touch & hold the display to play. Release to pause.";
  } else {
    footerHint.innerHTML = 
      `<span class="kbd">Space</span> hold, ` +
      `<span class="kbd">←</span>/<span class="kbd">→</span> step, ` +
      `<span class="kbd">↑</span>/<span class="kbd">↓</span> speed`;
  }
}

/**
 * Applies initial layout based on screen size
 */
function applyInitialLayout() {
  document.body.classList.remove("phoneShowRSVP", "phoneShowText");
  
  if (isPhone()) {
    document.body.classList.add("phoneShowRSVP");
    toggleTextBtn.textContent = "Show text";
  } else {
    toggleTextBtn.textContent = document.body.classList.contains("textHidden") 
      ? "Show text" 
      : "Hide text";
  }
  
  updateFooterHint();
}

// ============================================================================
// CHAPTER NAVIGATION
// ============================================================================

/**
 * Checks if there's a previous chapter available
 */
function hasPrevChapter() {
  return !!(currentBook && currentChapterIndex > 0);
}

/**
 * Checks if there's a next chapter available
 */
function hasNextChapter() {
  return !!(currentBook && 
            currentChapterIndex >= 0 && 
            currentChapterIndex < currentBook.chapters.length - 1);
}

/**
 * Updates the chapter chip display
 */
function updateChapterChip() {
  if (currentBook && currentChapterIndex >= 0) {
    chapterChip.textContent = `Chapter: ${currentChapterIndex + 1}/${currentBook.chapters.length}`;
  } else {
    chapterChip.textContent = "Chapter: —";
  }
}

/**
 * Updates chapter navigation button states
 */
function updateChapterButtons() {
  prevChapterBtn.disabled = !hasPrevChapter();
  nextChapterBtn.disabled = !hasNextChapter();
  updateChapterChip();
}

/**
 * Loads a chapter into the editor
 */
function loadChapter(index) {
  if (!currentBook) return;
  
  const chapter = currentBook.chapters[index];
  if (!chapter) return;

  setHeld(false);
  currentChapterIndex = index;
  updateChapterButtons();

  // Load chapter text into editor
  editor.value = chapter.text + "\n";
  editor.focus();
  editor.setSelectionRange(0, 0);

  setActiveChapterUI(index);
  refreshTokensAndIndexFromCursor();

  // On phone, switch to RSVP view
  if (isPhone()) showRSVPPhone();
}

/**
 * Loads the previous chapter
 */
function loadPrevChapter() {
  if (hasPrevChapter()) {
    loadChapter(currentChapterIndex - 1);
  }
}

/**
 * Loads the next chapter
 */
function loadNextChapter() {
  if (hasNextChapter()) {
    loadChapter(currentChapterIndex + 1);
  }
}

// ============================================================================
// EVENT HANDLERS - Chapter Navigation
// ============================================================================

prevChapterBtn.addEventListener("click", () => loadPrevChapter());
nextChapterBtn.addEventListener("click", () => loadNextChapter());

// Prevent pointer events from interfering with touch controls
prevChapterBtn.addEventListener("pointerdown", (e) => e.stopPropagation(), { passive: true });
nextChapterBtn.addEventListener("pointerdown", (e) => e.stopPropagation(), { passive: true });

// ============================================================================
// EVENT HANDLERS - Controls & Settings
// ============================================================================

wpmRange.addEventListener("input", () => syncWpmInputs(wpmRange));
wpmNum.addEventListener("input", () => syncWpmInputs(wpmNum));

showGuideBox.addEventListener("change", () => {
  anchorGuide.style.display = showGuideBox.checked ? "block" : "none";
});

pairShortWordsBox.addEventListener("change", () => {
  renderCurrent();
});

// ============================================================================
// EVENT HANDLERS - Text Editor
// ============================================================================

editor.addEventListener("input", () => {
  const caret = editor.selectionStart ?? 0;
  tokens = tokenizeWithOffsets(editor.value);
  totalLabel.textContent = String(tokens.length);
  idx = tokenIndexFromCaret(tokens, caret);
  renderCurrent();
  updateChapterButtons();
});

editor.addEventListener("click", refreshTokensAndIndexFromCursor);
editor.addEventListener("keyup", refreshTokensAndIndexFromCursor);

// ============================================================================
// EVENT HANDLERS - Navigation Buttons
// ============================================================================

rewindBtn.addEventListener("click", () => rewind(10));

backBtn.addEventListener("click", () => {
  setHeld(false);
  stepBack();
});

forwardBtn.addEventListener("click", () => {
  setHeld(false);
  stepForward();
});

resetBtn.addEventListener("click", () => {
  setHeld(false);
  refreshTokensAndIndexFromCursor();
});

toggleTextBtn.addEventListener("click", () => {
  setHeld(false);
  
  if (isPhone()) {
    if (document.body.classList.contains("phoneShowRSVP")) {
      showTextPhone();
    } else {
      showRSVPPhone();
    }
  } else {
    setDesktopTextHidden(!document.body.classList.contains("textHidden"));
  }
  
  updateFooterHint();
});

// ============================================================================
// EVENT HANDLERS - Window/Resize
// ============================================================================

window.addEventListener("resize", () => {
  applyInitialLayout();
  renderCurrent();
  updateChapterButtons();
});

// ============================================================================
// EVENT HANDLERS - Keyboard Controls
// ============================================================================

window.addEventListener("keydown", (e) => {
  // Space: Hold to play (dead-man switch)
  if (e.code === "Space") {
    e.preventDefault();
    
    // Ignore auto-repeat; require real release before starting again
    if (e.repeat) return;
    if (spaceDown) return;
    
    spaceDown = true;
    
    if (!isHeld) {
      refreshTokensAndIndexFromCursor();
      setHeld(true);
      if (isPhone() && document.body.classList.contains("phoneShowText")) {
        showRSVPPhone();
      }
    }
    return;
  }

  // Arrow keys: navigation and speed control
  if (e.code === "ArrowRight") {
    e.preventDefault();
    setHeld(false);
    stepForward();
  }
  
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    setHeld(false);
    stepBack();
  }
  
  if (e.code === "ArrowUp") {
    e.preventDefault();
    setHeld(false);
    const newWpm = Math.min(WPM_MAX, getWPM() + WPM_STEP);
    wpmNum.value = String(newWpm);
    syncWpmInputs(wpmNum);
  }
  
  if (e.code === "ArrowDown") {
    e.preventDefault();
    setHeld(false);
    const newWpm = Math.max(WPM_MIN, getWPM() - WPM_STEP);
    wpmNum.value = String(newWpm);
    syncWpmInputs(wpmNum);
  }
  
  if (e.code === "Escape") {
    e.preventDefault();
    setHeld(false);
  }
}, { passive: false });

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    spaceDown = false;
    setHeld(false, { reason: "release" });
  }
}, { passive: false });

// ============================================================================
// EVENT HANDLERS - Touch Controls
// ============================================================================

// Prevent context menu on long press
stageEl.addEventListener("contextmenu", (e) => e.preventDefault());

stageEl.addEventListener("pointerdown", (e) => {
  if (!touchMode()) return;
  
  e.preventDefault();
  stageEl.setPointerCapture(e.pointerId);

  if (!isHeld) {
    refreshTokensAndIndexFromCursor();
    setHeld(true);
    if (isPhone() && document.body.classList.contains("phoneShowText")) {
      showRSVPPhone();
    }
  }
}, { passive: false });

/**
 * Stops playback on pointer release (touch up/cancel/leave)
 */
function stopFromPointerRelease(e) {
  if (!touchMode()) return;
  
  e.preventDefault();
  if (isHeld) {
    setHeld(false, { reason: "release" });
  }
}

stageEl.addEventListener("pointerup", stopFromPointerRelease, { passive: false });
stageEl.addEventListener("pointercancel", stopFromPointerRelease, { passive: false });
stageEl.addEventListener("pointerleave", stopFromPointerRelease, { passive: false });

// ============================================================================
// EPUB PARSING & LOADING
// ============================================================================

/**
 * Sets error message in the UI
 */
function setError(msg) {
  epubError.textContent = msg || "";
}

/**
 * Clears the chapter list UI
 */
function clearChaptersUI() {
  chapterList.innerHTML = "";
  chapCount.textContent = "0";
}

/**
 * Sets the active chapter in the UI
 */
function setActiveChapterUI(index) {
  const buttons = chapterList.querySelectorAll(".chapterItem");
  buttons.forEach((btn, idx) => {
    btn.classList.toggle("active", idx === index);
  });
}

/**
 * Normalizes a relative path against a base path
 */
function normalizePath(basePath, rel) {
  if (!rel) return rel;
  
  // Absolute URLs stay as-is
  if (/^[a-z]+:\/\//i.test(rel)) return rel;
  
  // Remove leading slash
  if (rel.startsWith("/")) rel = rel.slice(1);
  
  // Get base directory
  const baseDir = basePath.includes("/") 
    ? basePath.slice(0, basePath.lastIndexOf("/") + 1) 
    : "";
  
  // Resolve path segments
  const stack = (baseDir + rel).split("/");
  const out = [];
  
  for (const part of stack) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  
  return out.join("/");
}

/**
 * Parses XML string into a DOM document
 */
function parseXml(xmlStr) {
  return new DOMParser().parseFromString(xmlStr, "application/xml");
}

/**
 * Gets the first text content matching a selector
 */
function firstText(element, selector) {
  const node = element.querySelector(selector);
  return node ? (node.textContent || "").trim() : "";
}

/**
 * Extracts readable text from XHTML content, preserving paragraph structure
 */
function extractReadableTextFromXhtml(xhtmlStr) {
  const doc = new DOMParser().parseFromString(xhtmlStr, "text/html");
  
  // Remove non-content elements
  doc.querySelectorAll("script, style, nav, header, footer").forEach(node => node.remove());
  
  const body = doc.body;
  if (!body) return "";
  
  // Add line breaks after block elements
  const blockSelectors = "p,div,section,article,h1,h2,h3,h4,h5,h6,li,br";
  body.querySelectorAll(blockSelectors).forEach(el => {
    if (el.tagName.toLowerCase() === "br") {
      el.replaceWith(doc.createTextNode("\n"));
    } else {
      el.insertAdjacentText("afterend", "\n");
    }
  });
  
  // Clean up whitespace
  let text = body.textContent || "";
  text = text.replace(/\r/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  
  return text.trim();
}

/**
 * Reads text content from a ZIP file entry
 */
async function readZipText(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return await file.async("string");
}

/**
 * Loads and parses an EPUB file from an ArrayBuffer
 */
async function loadEpubArrayBuffer(buf, displayName) {
  setError("");
  clearChaptersUI();
  epubMeta.textContent = `Loading: ${displayName} ...`;

  // Load ZIP archive
  const zip = await JSZip.loadAsync(buf);

  // Read container.xml to find OPF file
  const containerStr = await readZipText(zip, "META-INF/container.xml");
  if (!containerStr) {
    throw new Error("Invalid EPUB: META-INF/container.xml not found.");
  }

  const containerXml = parseXml(containerStr);
  const rootfile = containerXml.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) {
    throw new Error("Invalid EPUB: OPF path not found in container.xml.");
  }

  // Read OPF file
  const opfStr = await readZipText(zip, opfPath);
  if (!opfStr) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}.`);
  }

  const opfXml = parseXml(opfStr);

  // Extract metadata
  const title = firstText(opfXml, "metadata > title") ||
                firstText(opfXml, "metadata > dc\\:title") ||
                firstText(opfXml, "dc\\:title") ||
                displayName;
  
  const author = firstText(opfXml, "metadata > creator") ||
                 firstText(opfXml, "metadata > dc\\:creator") ||
                 firstText(opfXml, "dc\\:creator");

  epubMeta.textContent = author ? `${title} — ${author}` : `${title}`;

  // Build manifest map (id -> {href, media})
  const manifest = new Map();
  opfXml.querySelectorAll("manifest > item").forEach(item => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const media = item.getAttribute("media-type") || "";
    
    if (id && href) {
      manifest.set(id, {
        href: normalizePath(opfPath, href),
        media
      });
    }
  });

  // Get spine order (reading order)
  const spineIds = [];
  opfXml.querySelectorAll("spine > itemref").forEach(itemRef => {
    const idref = itemRef.getAttribute("idref");
    if (idref) spineIds.push(idref);
  });

  // Extract chapters from spine items
  const chapters = [];
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    
    const { href, media } = item;
    
    // Only process HTML/XHTML files
    const isHtml = media.includes("application/xhtml+xml") || 
                   media.includes("text/html") ||
                   href.toLowerCase().endsWith(".xhtml") ||
                   href.toLowerCase().endsWith(".html") ||
                   href.toLowerCase().endsWith(".htm");
    
    if (!isHtml) continue;

    const xhtml = await readZipText(zip, href);
    if (!xhtml) continue;

    // Extract chapter title
    const doc = new DOMParser().parseFromString(xhtml, "text/html");
    const titleText = (doc.querySelector("title")?.textContent || "").trim();
    const headingText = (doc.querySelector("h1,h2,h3")?.textContent || "").trim();
    const chapterTitle = titleText || headingText || `Chapter ${chapters.length + 1}`;

    // Extract readable text
    const text = extractReadableTextFromXhtml(xhtml);
    if (!text) continue;

    chapters.push({ title: chapterTitle, href, text });
  }

  if (!chapters.length) {
    throw new Error("Could not find readable chapters in this EPUB.");
  }

  // Update state
  currentBook = { title, author, chapters };
  currentChapterIndex = 0;
  updateChapterButtons();

  renderChapterList(chapters);
  loadChapter(0);
}

/**
 * Loads an EPUB file from a File object
 */
async function loadEpubFile(file) {
  const buf = await file.arrayBuffer();
  await loadEpubArrayBuffer(buf, file.name);
}

/**
 * Renders the chapter list UI
 */
function renderChapterList(chapters) {
  chapterList.innerHTML = "";
  chapCount.textContent = String(chapters.length);

  chapters.forEach((chapter, index) => {
    const btn = document.createElement("button");
    btn.className = "chapterItem";
    btn.type = "button";
    btn.innerHTML = 
      `<span class="chapterNum">${String(index + 1).padStart(2, "0")}</span>` +
      `<span class="chapterTitle">${escapeHtml(chapter.title)}</span>`;
    btn.addEventListener("click", () => loadChapter(index));
    chapterList.appendChild(btn);
  });
}

// ============================================================================
// EVENT HANDLERS - EPUB Import
// ============================================================================

/**
 * Resets book state to empty
 */
function resetBookState() {
  currentBook = null;
  currentChapterIndex = -1;
  updateChapterButtons();
  epubMeta.textContent = "No book loaded.";
  clearChaptersUI();
}

// Import mode toggle (File vs URL)
importModeRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    if (radio.value === "file") {
      importFile.style.display = "";
      importUrl.style.display = "none";
    } else {
      importFile.style.display = "none";
      importUrl.style.display = "";
      epubUrl.focus();
    }
  });
});

// File input handler
epubFile.addEventListener("change", async () => {
  const file = epubFile.files?.[0];
  if (!file) return;
  
  try {
    currentSourceKey = "upload:" + file.name;
    bookDropdown.value = "";
    await loadEpubFile(file);
    setError("");
  } catch (err) {
    console.error(err);
    resetBookState();
    setError(String(err?.message || err));
  } finally {
    epubFile.value = "";
  }
});

/**
 * Loads an EPUB from a URL (with CORS proxy fallback)
 */
async function loadEpubFromUrl() {
  const url = epubUrl.value.trim();
  if (!url) return;

  if (!/^https?:\/\//i.test(url)) {
    setError("Please enter a valid URL starting with http:// or https://");
    return;
  }

  try {
    currentSourceKey = "url:" + url;
    bookDropdown.value = "";
    setHeld(false);
    epubMeta.textContent = `Loading from URL...`;

    // Try direct fetch with CORS mode
    let resp;
    try {
      resp = await fetch(url, {
        cache: "no-store",
        mode: "cors",
        credentials: "omit"
      });
    } catch (fetchErr) {
      // If CORS fails, try with a CORS proxy as fallback
      if (fetchErr.name === "TypeError" &&
          (fetchErr.message.includes("Failed to fetch") ||
           fetchErr.message.includes("NetworkError"))) {
        console.log("Direct fetch failed, trying CORS proxy...");
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        resp = await fetch(proxyUrl, { cache: "no-store" });
      } else {
        throw fetchErr;
      }
    }

    if (!resp.ok) {
      throw new Error(`Could not load EPUB from URL: ${resp.status} ${resp.statusText}`);
    }

    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength === 0) {
      throw new Error("Downloaded file is empty");
    }

    epubFile.value = "";
    const displayName = new URL(url).pathname.split("/").pop() || url;
    await loadEpubArrayBuffer(buf, displayName);
    setError("");
  } catch (err) {
    console.error(err);
    resetBookState();
    
    let errorMsg = String(err?.message || err);
    if (errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("NetworkError") ||
        (err?.name === "TypeError" && err?.message?.includes("fetch"))) {
      errorMsg = "CORS error: The server doesn't allow direct browser downloads. " +
                 "The app will try using a CORS proxy automatically, but if it still fails, " +
                 "download the file locally and use the File option instead.";
    }
    setError(errorMsg);
  }
}

loadUrlBtn.addEventListener("click", loadEpubFromUrl);
epubUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    loadEpubFromUrl();
  }
});

/**
 * Loads the books manifest from books/index.json
 */
async function loadBooksManifest() {
  try {
    const resp = await fetch("books/index.json", { cache: "no-store" });
    if (!resp.ok) {
      throw new Error("books/index.json not found (need to serve via http).");
    }
    
    const data = await resp.json();

    if (!Array.isArray(data) || data.length === 0) {
      bookDropdown.innerHTML = `<option value="">No books in books/index.json</option>`;
      return;
    }

    bookDropdown.innerHTML = `<option value="">Choose a book from books/…</option>`;
    
    for (const item of data) {
      if (!item) continue;
      
      // Get source (URL or file path)
      const source = (typeof item.url === "string" && item.url.trim())
        ? item.url.trim()
        : (typeof item.file === "string" && item.file.trim())
        ? item.file.trim()
        : null;
      
      if (!source) continue;
      
      // Get title (fallback to source)
      const title = (typeof item.title === "string" && item.title.trim())
        ? item.title.trim()
        : source;
      
      const opt = document.createElement("option");
      opt.value = source;
      opt.textContent = title;
      bookDropdown.appendChild(opt);
    }
  } catch (err) {
    bookDropdown.innerHTML = `<option value="">(books/ list unavailable)</option>`;
    setError("To use the books/ dropdown, run a local server and create books/index.json. " +
             "Example: python -m http.server");
  }
}

// Books dropdown handler
bookDropdown.addEventListener("change", async () => {
  const source = bookDropdown.value;
  if (!source) return;

  const key = "books:" + source;
  if (key === currentSourceKey) return;

  try {
    currentSourceKey = key;
    setHeld(false);

    // Check if source is a URL or a local file
    const isUrl = /^https?:\/\//i.test(source);
    const fetchPath = isUrl ? source : "books/" + source;

    const resp = await fetch(fetchPath, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Could not load ${isUrl ? source : `books/${source}`}`);
    }
    
    const buf = await resp.arrayBuffer();
    epubFile.value = "";
    
    const displayName = isUrl
      ? new URL(source).pathname.split("/").pop() || source
      : source;
    
    await loadEpubArrayBuffer(buf, displayName);
    setError("");
  } catch (err) {
    console.error(err);
    resetBookState();
    setError(String(err?.message || err));
  }
});

// Clear button handler
clearBtn.addEventListener("click", () => {
  setHeld(false);
  editor.value = "";
  clearChaptersUI();
  currentBook = null;
  currentChapterIndex = -1;
  currentSourceKey = "";
  bookDropdown.value = "";
  epubMeta.textContent = "No book loaded.";
  setError("");
  refreshTokensAndIndexFromCursor();
  updateChapterButtons();
});

// ============================================================================
// INITIALIZATION
// ============================================================================

syncWpmInputs(wpmNum);
refreshTokensAndIndexFromCursor();
anchorGuide.style.display = showGuideBox.checked ? "block" : "none";
applyInitialLayout();
loadBooksManifest();
updateChapterButtons();
