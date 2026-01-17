// ---------------------- RSVP core ----------------------
function tokenizeWithOffsets(text){
  const tokens=[];
  const re=/\S+/g;
  let m;
  while((m=re.exec(text))!==null){
    tokens.push({value:m[0], start:m.index, end:m.index+m[0].length});
  }
  return tokens;
}

function tokenIndexFromCaret(tokens, caretPos){
  if(!tokens.length) return 0;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(caretPos>=t.start && caretPos<t.end) return i;
    if(caretPos<t.start) return i;
  }
  return tokens.length-1;
}

function orpIndex(word){
  const len=word.length;
  if(len<=1) return 0;
  if(len<=5) return 1;
  if(len<=9) return 2;
  if(len<=13) return 3;
  return 4;
}

function baseMsPerWord(wpm){ return 60000/Math.max(1,wpm); }

function extraPauseMs(tokenValue, smart){
  if(!smart) return 0;
  if(/[.?!]["')\]]?$/.test(tokenValue)) return 220;
  if(/[,;:]["')\]]?$/.test(tokenValue)) return 120;
  if(/—$/.test(tokenValue)) return 120;
  return 0;
}

function longWordBonusMs(tokenValue, smart){
  if(!smart) return 0;
  const bare=tokenValue.replace(/^[("'\[]+|[)"'\].,;:!?]+$/g,"");
  const len=bare.length;
  if(len>=12) return 120;
  if(len>=9) return 70;
  return 0;
}

const measureCanvas=document.createElement("canvas");
const ctx=measureCanvas.getContext("2d");
function measureTextPx(text, font){ ctx.font=font; return ctx.measureText(text).width; }

function escapeHtml(s){
  return s.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function buildWordHTML(tokenValue, anchorIdx){
  const pre=tokenValue.slice(0,anchorIdx);
  const ch=tokenValue.charAt(anchorIdx)||"";
  const post=tokenValue.slice(anchorIdx+1);
  return `<span class="pre">${escapeHtml(pre)}</span><span class="orp">${escapeHtml(ch)}</span><span class="post">${escapeHtml(post)}</span>`;
}

function positionWordAtAnchor(wordEl, tokenValue, anchorIdx){
  const style=getComputedStyle(wordEl);
  const fontFamily=style.fontFamily, fontSize=style.fontSize, fontStyle=style.fontStyle, fontVariant=style.fontVariant, lineHeight=style.lineHeight;
  const fontNormal=`${fontStyle} ${fontVariant} 400 ${fontSize} / ${lineHeight} ${fontFamily}`;
  const fontBold  =`${fontStyle} ${fontVariant} 800 ${fontSize} / ${lineHeight} ${fontFamily}`;
  const pre=tokenValue.slice(0,anchorIdx);
  const ch=tokenValue.charAt(anchorIdx)||"";
  const preW=measureTextPx(pre,fontNormal);
  const chW=measureTextPx(ch,fontBold);
  const shiftX=preW+(chW/2);
  wordEl.style.transform=`translate(${-shiftX}px, -50%)`;
}

const editor=document.getElementById("editor");
const stageEl=document.getElementById("stage");
const wordEl=document.getElementById("word");
const idxLabel=document.getElementById("idxLabel");
const totalLabel=document.getElementById("totalLabel");
const statusPill=document.getElementById("statusPill");
const footerHint=document.getElementById("footerHint");

const wpmRange=document.getElementById("wpmRange");
const wpmNum=document.getElementById("wpmNum");
const smartPausesBox=document.getElementById("smartPauses");
const showGuideBox=document.getElementById("showGuide");
const pairShortWordsBox=document.getElementById("pairShortWords");
const anchorGuide=document.getElementById("anchorGuide");

const toggleTextBtn=document.getElementById("toggleTextBtn");
const rewindBtn=document.getElementById("rewindBtn");
const backBtn=document.getElementById("backBtn");
const forwardBtn=document.getElementById("forwardBtn");
const resetBtn=document.getElementById("resetBtn");

const chapterChip=document.getElementById("chapterChip");
const prevChapterBtn=document.getElementById("prevChapterBtn");
const nextChapterBtn=document.getElementById("nextChapterBtn");

let tokens=[], idx=0;
let isHeld=false, timerId=null;

// Prevent Space auto-repeat from restarting after end:
let spaceDown = false;

// Chapter state
let currentBook=null;           // { title, author, chapters:[{title,text}] }
let currentChapterIndex=-1;     // -1 when not loaded from EPUB
let currentSourceKey="";        // upload:... or books:...

// --- Pair short words (display bundle) ---
const SHORT_WORD_MAX = 2; // tweak: 2 pairs "of a", "to be", "in it"; set to 3 if you want more pairing

function stripEdgePunct(s){
  return s.replace(/^[("'\[]+|[)"'\].,;:!?]+$/g,"");
}
function endsWithPausePunct(s){
  return /[.?!,;:]["')\]]?$/.test(s);
}
function isShortWord(s){
  const bare = stripEdgePunct(s);
  return bare.length > 0 && bare.length <= SHORT_WORD_MAX;
}

function getDisplayBundle(i){
  // Returns { text, advanceBy }
  if(!tokens.length) return { text:"", advanceBy:1 };

  const t0 = tokens[i]?.value ?? "";
  if(!pairShortWordsBox.checked) return { text: t0, advanceBy: 1 };
  if(i >= tokens.length - 1) return { text: t0, advanceBy: 1 };

  const t1 = tokens[i+1]?.value ?? "";
  // Pair only if both short, and t0 doesn't end in punctuation that indicates a pause/boundary
  if(isShortWord(t0) && isShortWord(t1) && !endsWithPausePunct(t0)){
    return { text: `${t0} ${t1}`, advanceBy: 2 };
  }
  return { text: t0, advanceBy: 1 };
}

function refreshTokensAndIndexFromCursor(){
  tokens=tokenizeWithOffsets(editor.value);
  totalLabel.textContent=String(tokens.length);
  const caret=editor.selectionStart ?? 0;
  idx=tokenIndexFromCaret(tokens, caret);
  renderCurrent();
  updateChapterButtons();
}

function renderCurrent(){
  if(!tokens.length){
    wordEl.innerHTML=`<span class="pre"></span><span class="orp"></span><span class="post"></span>`;
    idxLabel.textContent="0";
    return;
  }

  idx=Math.max(0,Math.min(idx,tokens.length-1));

  const bundle = getDisplayBundle(idx);
  const token = bundle.text;

  const bare=stripEdgePunct(token);
  const bareStart=token.indexOf(bare);
  const anchorInBare=orpIndex(bare);
  const anchor=Math.max(0,Math.min(token.length-1,bareStart+anchorInBare));

  wordEl.innerHTML=buildWordHTML(token,anchor);
  positionWordAtAnchor(wordEl, token, anchor);

  idxLabel.textContent=String(idx+1);
}

function stepForward(){
  if(!tokens.length) return;
  const bundle = getDisplayBundle(idx);
  idx = Math.min(tokens.length-1, idx + bundle.advanceBy);
  renderCurrent();
  updateChapterButtons();
}
function stepBack(){
  if(!tokens.length) return;
  // stepping back by 1 keeps behavior intuitive
  idx = Math.max(0, idx - 1);
  renderCurrent();
  updateChapterButtons();
}
function rewind(n){
  if(!tokens.length) return;
  idx=Math.max(0, idx-n);
  renderCurrent();
  updateChapterButtons();
}

function getWPM(){ return Number(wpmNum.value)||350; }
function syncWpmInputs(from){
  const v=Math.max(100,Math.min(900, Number(from.value)||350));
  wpmRange.value=String(v); wpmNum.value=String(v);
}

function isAtEndOfChapter(){
  return tokens.length > 0 && idx >= tokens.length - 1;
}

function moveCaretToCurrentToken(){
  editor.focus({ preventScroll: true });

  // If we're at the end, place caret at end-of-text.
  if(isAtEndOfChapter()){
    const endPos = editor.value.length;
    editor.setSelectionRange(endPos, endPos);
    editor.scrollTop = editor.scrollHeight;
    return;
  }

  // Otherwise place caret at start of current token.
  if(!tokens.length) return;
  const t=tokens[Math.max(0, Math.min(idx, tokens.length-1))];
  const pos=t.start;
  editor.setSelectionRange(pos, pos);

  // Scroll roughly to keep caret visible
  const before = editor.value.slice(0, pos);
  const lineCount = before.split("\n").length - 1;
  const approxLineHeight = 20;
  const targetY = Math.max(0, (lineCount * approxLineHeight) - editor.clientHeight / 3);
  editor.scrollTop = targetY;
}


function scheduleNextTick(){
  clearTimeout(timerId); timerId=null;
  if(!isHeld || !tokens.length) return;

  const wpm=getWPM();
  const smart=smartPausesBox.checked;

  const bundle = getDisplayBundle(idx);
  const token = bundle.text;

  let ms=baseMsPerWord(wpm);
  ms+=extraPauseMs(token, smart);
  ms+=longWordBonusMs(token, smart);

  timerId=setTimeout(()=>{
    if(!isHeld) return;

    const adv = getDisplayBundle(idx).advanceBy;
    const nextIdx = idx + adv;

    if(nextIdx <= tokens.length-1){
      idx = Math.min(tokens.length-1, nextIdx);
      renderCurrent();
      updateChapterButtons();

      // If we just landed on the last token, we still schedule no more advance until end check triggers
      // Next tick decides whether to stop.
      if(idx >= tokens.length-1){
        setHeld(false, { reason: "end" });
        return;
      }

      scheduleNextTick();
    } else {
      setHeld(false, { reason: "end" });
    }
  }, ms);
}

function setHeld(held, meta = {}){
  const wasHeld = isHeld;
  isHeld=held;

  statusPill.textContent=held ? "Playing (held)" : "Paused";
  statusPill.style.borderColor=held ? "rgba(92,200,255,0.5)" : "rgba(255,255,255,0.08)";

  if(held){
    scheduleNextTick();
  } else {
    clearTimeout(timerId); timerId=null;
    // Only jump caret on release (not on end)
    if(wasHeld && meta.reason === "release"){
      moveCaretToCurrentToken();
    }
    updateChapterButtons();
  }
}

// ---------------------- Layout helpers ----------------------
function isPhone(){ return window.matchMedia("(max-width: 920px)").matches; }
function touchMode(){ return window.matchMedia("(pointer: coarse)").matches; }

function showRSVPPhone(){
  document.body.classList.remove("phoneShowText");
  document.body.classList.add("phoneShowRSVP");
  toggleTextBtn.textContent = "Show text";
}
function showTextPhone(){
  document.body.classList.remove("phoneShowRSVP");
  document.body.classList.add("phoneShowText");
  toggleTextBtn.textContent = "Hide text";
}
function setDesktopTextHidden(hidden){
  document.body.classList.toggle("textHidden", hidden);
  toggleTextBtn.textContent = hidden ? "Show text" : "Hide text";
}

function updateFooterHint(){
  if(touchMode()){
    footerHint.textContent = "Touch & hold the display to play. Release to pause.";
  } else {
    footerHint.innerHTML = `<span class="kbd">Space</span> hold, <span class="kbd">←</span>/<span class="kbd">→</span> step, <span class="kbd">↑</span>/<span class="kbd">↓</span> speed`;
  }
}

function applyInitialLayout(){
  document.body.classList.remove("phoneShowRSVP","phoneShowText");
  if(isPhone()){
    document.body.classList.add("phoneShowRSVP");
    toggleTextBtn.textContent = "Show text";
  }else{
    toggleTextBtn.textContent = document.body.classList.contains("textHidden") ? "Show text" : "Hide text";
  }
  updateFooterHint();
}

// ---------------------- Chapter buttons ----------------------
function hasPrevChapter(){
  return !!(currentBook && currentChapterIndex > 0);
}
function hasNextChapter(){
  return !!(currentBook && currentChapterIndex >= 0 && currentChapterIndex < currentBook.chapters.length - 1);
}

function updateChapterChip(){
  if(currentBook && currentChapterIndex >= 0){
    chapterChip.textContent = `Chapter: ${currentChapterIndex + 1}/${currentBook.chapters.length}`;
  } else {
    chapterChip.textContent = "Chapter: —";
  }
}

function updateChapterButtons(){
  prevChapterBtn.disabled = !hasPrevChapter();
  nextChapterBtn.disabled = !hasNextChapter();
  updateChapterChip();
}

function loadChapter(i){
  if(!currentBook) return;
  const ch=currentBook.chapters[i];
  if(!ch) return;

  setHeld(false);
  currentChapterIndex = i;
  updateChapterButtons();

  editor.value = ch.text + "\n";
  editor.focus();
  editor.setSelectionRange(0,0);

  setActiveChapterUI(i);
  refreshTokensAndIndexFromCursor();

  if(isPhone()) showRSVPPhone();
}

function loadPrevChapter(){ if(hasPrevChapter()) loadChapter(currentChapterIndex - 1); }
function loadNextChapter(){ if(hasNextChapter()) loadChapter(currentChapterIndex + 1); }

prevChapterBtn.addEventListener("click", ()=>loadPrevChapter());
nextChapterBtn.addEventListener("click", ()=>loadNextChapter());

prevChapterBtn.addEventListener("pointerdown", (e)=>e.stopPropagation(), {passive:true});
nextChapterBtn.addEventListener("pointerdown", (e)=>e.stopPropagation(), {passive:true});

// ---------------------- UI wiring ----------------------
wpmRange.addEventListener("input", ()=>syncWpmInputs(wpmRange));
wpmNum.addEventListener("input", ()=>syncWpmInputs(wpmNum));

showGuideBox.addEventListener("change", ()=>{
  anchorGuide.style.display = showGuideBox.checked ? "block" : "none";
});

pairShortWordsBox.addEventListener("change", ()=>{
  renderCurrent();
});

editor.addEventListener("input", ()=>{
  const caret=editor.selectionStart ?? 0;
  tokens=tokenizeWithOffsets(editor.value);
  totalLabel.textContent=String(tokens.length);
  idx=tokenIndexFromCaret(tokens, caret);
  renderCurrent();
  updateChapterButtons();
});
editor.addEventListener("click", refreshTokensAndIndexFromCursor);
editor.addEventListener("keyup", refreshTokensAndIndexFromCursor);

rewindBtn.addEventListener("click", ()=>rewind(10));
backBtn.addEventListener("click", ()=>{ setHeld(false); stepBack(); });
forwardBtn.addEventListener("click", ()=>{ setHeld(false); stepForward(); });
resetBtn.addEventListener("click", ()=>{ setHeld(false); refreshTokensAndIndexFromCursor(); });

toggleTextBtn.addEventListener("click", ()=>{
  setHeld(false);
  if(isPhone()){
    if(document.body.classList.contains("phoneShowRSVP")) showTextPhone();
    else showRSVPPhone();
  } else {
    setDesktopTextHidden(!document.body.classList.contains("textHidden"));
  }
  updateFooterHint();
});

window.addEventListener("resize", ()=>{
  applyInitialLayout();
  renderCurrent();
  updateChapterButtons();
});

// Desktop keyboard controls (fix end-restart)
window.addEventListener("keydown", (e)=>{
  if(e.code==="Space") e.preventDefault();

  if(e.code==="Space"){
    // Ignore auto-repeat; require real release before starting again
    if(e.repeat) return;

    if(spaceDown) return;
    spaceDown = true;

    if(!isHeld){
      refreshTokensAndIndexFromCursor();
      setHeld(true);
      if(isPhone() && document.body.classList.contains("phoneShowText")) showRSVPPhone();
    }
    return;
  }

  if(e.code==="ArrowRight"){ e.preventDefault(); setHeld(false); stepForward(); }
  if(e.code==="ArrowLeft"){  e.preventDefault(); setHeld(false); stepBack(); }
  if(e.code==="ArrowUp"){
    e.preventDefault(); setHeld(false);
    const v=Math.min(900, getWPM()+10);
    wpmNum.value=String(v); syncWpmInputs(wpmNum);
  }
  if(e.code==="ArrowDown"){
    e.preventDefault(); setHeld(false);
    const v=Math.max(100, getWPM()-10);
    wpmNum.value=String(v); syncWpmInputs(wpmNum);
  }
  if(e.code==="Escape"){ e.preventDefault(); setHeld(false); }
}, {passive:false});

window.addEventListener("keyup", (e)=>{
  if(e.code==="Space"){
    e.preventDefault();
    spaceDown = false;
    setHeld(false, { reason: "release" });
  }
}, {passive:false});

// Mobile/touch: press-and-hold on the RSVP stage
stageEl.addEventListener("contextmenu", (e)=>e.preventDefault());

stageEl.addEventListener("pointerdown", (e)=>{
  if(!touchMode()) return;
  e.preventDefault();
  stageEl.setPointerCapture(e.pointerId);

  if(!isHeld){
    refreshTokensAndIndexFromCursor();
    setHeld(true);
    if(isPhone() && document.body.classList.contains("phoneShowText")) showRSVPPhone();
  }
}, {passive:false});

function stopFromPointerRelease(e){
  if(!touchMode()) return;
  e.preventDefault();
  if(isHeld) setHeld(false, { reason: "release" });
}
stageEl.addEventListener("pointerup", stopFromPointerRelease, {passive:false});
stageEl.addEventListener("pointercancel", stopFromPointerRelease, {passive:false});
stageEl.addEventListener("pointerleave", stopFromPointerRelease, {passive:false});

// ---------------------- EPUB + books dropdown ----------------------
const epubFile=document.getElementById("epubFile");
const epubMeta=document.getElementById("epubMeta");
const epubError=document.getElementById("epubError");
const chapterList=document.getElementById("chapterList");
const chapCount=document.getElementById("chapCount");
const bookDropdown=document.getElementById("bookDropdown");

function setError(msg){ epubError.textContent=msg||""; }
function clearChaptersUI(){ chapterList.innerHTML=""; chapCount.textContent="0"; }

function setActiveChapterUI(i){
  const buttons=chapterList.querySelectorAll(".chapterItem");
  buttons.forEach((b,idx)=>b.classList.toggle("active", idx===i));
}

function normalizePath(basePath, rel){
  if(!rel) return rel;
  if(/^[a-z]+:\/\//i.test(rel)) return rel;
  if(rel.startsWith("/")) rel=rel.slice(1);
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")+1) : "";
  const stack=(baseDir+rel).split("/");
  const out=[];
  for(const part of stack){
    if(!part || part===".") continue;
    if(part==="..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function parseXml(xmlStr){ return new DOMParser().parseFromString(xmlStr,"application/xml"); }
function firstText(el, selector){
  const node=el.querySelector(selector);
  return node ? (node.textContent||"").trim() : "";
}

function extractReadableTextFromXhtml(xhtmlStr){
  const doc=new DOMParser().parseFromString(xhtmlStr,"text/html");
  doc.querySelectorAll("script, style, nav, header, footer").forEach(n=>n.remove());
  const body=doc.body; if(!body) return "";
  const blockSelectors="p,div,section,article,h1,h2,h3,h4,h5,h6,li,br";
  body.querySelectorAll(blockSelectors).forEach(el=>{
    if(el.tagName.toLowerCase()==="br") el.replaceWith(doc.createTextNode("\n"));
    else el.insertAdjacentText("afterend","\n");
  });
  let text=body.textContent||"";
  text=text.replace(/\r/g,"");
  text=text.replace(/[ \t]+\n/g,"\n");
  text=text.replace(/\n{3,}/g,"\n\n");
  text=text.replace(/[ \t]{2,}/g," ");
  return text.trim();
}

async function readZipText(zip, path){
  const f=zip.file(path);
  if(!f) return null;
  return await f.async("string");
}

async function loadEpubArrayBuffer(buf, displayName){
  setError(""); clearChaptersUI();
  epubMeta.textContent=`Loading: ${displayName} ...`;

  const zip=await JSZip.loadAsync(buf);

  const containerStr=await readZipText(zip,"META-INF/container.xml");
  if(!containerStr) throw new Error("Invalid EPUB: META-INF/container.xml not found.");

  const containerXml=parseXml(containerStr);
  const rootfile=containerXml.querySelector("rootfile");
  const opfPath=rootfile?.getAttribute("full-path");
  if(!opfPath) throw new Error("Invalid EPUB: OPF path not found in container.xml.");

  const opfStr=await readZipText(zip, opfPath);
  if(!opfStr) throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}.`);

  const opfXml=parseXml(opfStr);

  const title = firstText(opfXml,"metadata > title") ||
                firstText(opfXml,"metadata > dc\\:title") ||
                firstText(opfXml,"dc\\:title") ||
                displayName;
  const author = firstText(opfXml,"metadata > creator") ||
                 firstText(opfXml,"metadata > dc\\:creator") ||
                 firstText(opfXml,"dc\\:creator");

  epubMeta.textContent = author ? `${title} — ${author}` : `${title}`;

  const manifest=new Map();
  opfXml.querySelectorAll("manifest > item").forEach(item=>{
    const id=item.getAttribute("id");
    const href=item.getAttribute("href");
    const media=item.getAttribute("media-type")||"";
    if(id && href) manifest.set(id,{href:normalizePath(opfPath,href), media});
  });

  const spineIds=[];
  opfXml.querySelectorAll("spine > itemref").forEach(ir=>{
    const idref=ir.getAttribute("idref");
    if(idref) spineIds.push(idref);
  });

  const chapters=[];
  for(const id of spineIds){
    const item=manifest.get(id);
    if(!item) continue;
    const {href, media}=item;
    const ok = media.includes("application/xhtml+xml") || media.includes("text/html") ||
               href.toLowerCase().endsWith(".xhtml") || href.toLowerCase().endsWith(".html") || href.toLowerCase().endsWith(".htm");
    if(!ok) continue;

    const xhtml=await readZipText(zip, href);
    if(!xhtml) continue;

    const doc=new DOMParser().parseFromString(xhtml,"text/html");
    const t=(doc.querySelector("title")?.textContent||"").trim();
    const h=(doc.querySelector("h1,h2,h3")?.textContent||"").trim();
    const chapterTitle=t || h || `Chapter ${chapters.length+1}`;

    const text=extractReadableTextFromXhtml(xhtml);
    if(!text) continue;

    chapters.push({title:chapterTitle, href, text});
  }

  if(!chapters.length) throw new Error("Could not find readable chapters in this EPUB.");

  currentBook={title, author, chapters};
  currentChapterIndex = 0;
  updateChapterButtons();

  renderChapterList(chapters);
  loadChapter(0);
}

async function loadEpubFile(file){
  const buf=await file.arrayBuffer();
  await loadEpubArrayBuffer(buf, file.name);
}

function renderChapterList(chapters){
  chapterList.innerHTML="";
  chapCount.textContent=String(chapters.length);

  chapters.forEach((ch,i)=>{
    const btn=document.createElement("button");
    btn.className="chapterItem";
    btn.type="button";
    btn.innerHTML=`<span class="chapterNum">${String(i+1).padStart(2,"0")}</span>
                   <span class="chapterTitle">${escapeHtml(ch.title)}</span>`;
    btn.addEventListener("click", ()=>loadChapter(i));
    chapterList.appendChild(btn);
  });
}

// File input
epubFile.addEventListener("change", async ()=>{
  const file=epubFile.files?.[0];
  if(!file) return;
  try{
    currentSourceKey = "upload:" + file.name;
    bookDropdown.value = "";
    await loadEpubFile(file);
    setError("");
  }catch(err){
    console.error(err);
    currentBook=null;
    currentChapterIndex=-1;
    updateChapterButtons();
    epubMeta.textContent="No book loaded.";
    clearChaptersUI();
    setError(String(err?.message || err));
  }finally{
    epubFile.value="";
  }
});

// Books/ manifest dropdown (Option A)
async function loadBooksManifest(){
  try{
    const resp = await fetch("books/index.json", { cache: "no-store" });
    if(!resp.ok) throw new Error("books/index.json not found (need to serve via http).");
    const data = await resp.json();

    if(!Array.isArray(data) || data.length===0){
      bookDropdown.innerHTML = `<option value="">No books in books/index.json</option>`;
      return;
    }

    bookDropdown.innerHTML = `<option value="">Choose a book from books/…</option>`;
    for(const item of data){
      if(!item || typeof item.file!=="string") continue;
      const title = (typeof item.title==="string" && item.title.trim()) ? item.title.trim() : item.file;
      const opt = document.createElement("option");
      opt.value = item.file;
      opt.textContent = title;
      bookDropdown.appendChild(opt);
    }
  }catch(err){
    bookDropdown.innerHTML = `<option value="">(books/ list unavailable)</option>`;
    setError("To use the books/ dropdown, run a local server and create books/index.json. Example: python -m http.server");
  }
}

bookDropdown.addEventListener("change", async ()=>{
  const file = bookDropdown.value;
  if(!file) return;

  const key = "books:" + file;
  if(key === currentSourceKey) return;

  try{
    currentSourceKey = key;
    setHeld(false);

    const resp = await fetch("books/" + file, { cache: "no-store" });
    if(!resp.ok) throw new Error(`Could not load books/${file}`);
    const buf = await resp.arrayBuffer();

    epubFile.value = "";
    await loadEpubArrayBuffer(buf, file);
    setError("");
  }catch(err){
    console.error(err);
    currentBook=null;
    currentChapterIndex=-1;
    updateChapterButtons();
    epubMeta.textContent="No book loaded.";
    clearChaptersUI();
    setError(String(err?.message || err));
  }
});

// ---------------------- Init ----------------------
syncWpmInputs(wpmNum);
refreshTokensAndIndexFromCursor();
anchorGuide.style.display = showGuideBox.checked ? "block" : "none";
applyInitialLayout();
loadBooksManifest();
updateChapterButtons();
