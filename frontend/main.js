const invoke = (...args) => {
  const api = window.__TAURI__?.core?.invoke;
  if (!api) throw new Error("OrbOffice must be run as a desktop application.");
  return api(...args);
};
const state = { documents:[], renameTarget:null, deleteTarget:null, activeDocument:null, dirty:false, saveTimer:null, saving:null, toastTimer:null };
const el = {
  count:document.querySelector("#document-count"), sideCount:document.querySelector("#sidebar-count"),
  list:document.querySelector("#documents-container"), search:document.querySelector("#search-input"),
  toast:document.querySelector("#toast"), workspace:document.querySelector("#workspace-page"),
  writer:document.querySelector("#writer-page"), title:document.querySelector("#writer-title"),
  editor:document.querySelector("#writer-editor"), wordCount:document.querySelector("#writer-count"),
  saveState:document.querySelector("#save-state"), saveButton:document.querySelector("#writer-save-button"),
  renameDialog:document.querySelector("#rename-dialog"), renameInput:document.querySelector("#rename-input"),
  deleteDialog:document.querySelector("#delete-dialog"), deleteMessage:document.querySelector("#delete-message")
};
const docIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z"/><path d="M14 3.9v4.4h4.1M8.5 12h7M8.5 15.5h7"/></svg>';
const safeTags = new Set(["P","BR","STRONG","B","EM","I","U","H1","H2","UL","OL","LI","BLOCKQUOTE","A"]);

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), 2600);
}
function formatDate(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(date);
}
function nav(view) {
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("is-active",button.dataset.view===view));
}
function breadcrumb(value) { document.querySelector("#breadcrumb-current").textContent = value; }
function saveStatus(value,error=false) {
  document.querySelector("#save-state").textContent = value;
  document.querySelector("#save-state").classList.toggle("is-error",error);
}
function cleanHtml(input) {
  const parsed = new DOMParser().parseFromString("<div>"+String(input||"")+"</div>","text/html");
  const source = parsed.body.firstElementChild;
  const output = document.createElement("div");
  function visit(node,parent) {
    if (node.nodeType===Node.TEXT_NODE) { parent.append(document.createTextNode(node.nodeValue||"")); return; }
    if (node.nodeType!==Node.ELEMENT_NODE) return;
    const tag = node.tagName.toUpperCase();
    if (!safeTags.has(tag)) { Array.from(node.childNodes).forEach(child=>visit(child,parent)); return; }
    const safe = document.createElement(tag.toLowerCase());
    if (tag==="A") {
      try {
        const url = new URL(node.getAttribute("href")||"",window.location.href);
        if (["https:","http:","mailto:"].includes(url.protocol)) {
          safe.href=url.href; safe.target="_blank"; safe.rel="noopener noreferrer";
        }
      } catch {}
    }
    Array.from(node.childNodes).forEach(child=>visit(child,safe));
    parent.append(safe);
  }
  Array.from(source.childNodes).forEach(child=>visit(child,output));
  return output.innerHTML;
}
function updateWordCount() {
  const value = el.editor.innerText||"";
  const trimmed=value.trim();
  const words=trimmed?trimmed.split(/\s+/u).length:0;
  el.wordCount.textContent=words+" words · "+value.replace(/\n$/u,"").length+" characters";
}
function markDirty() {
  if (!state.activeDocument) return;
  state.dirty=true; saveStatus("Unsaved changes"); updateWordCount();
  clearTimeout(state.saveTimer);
  state.saveTimer=setTimeout(()=>saveDocument(),1000);
}
function showWorkspace(view="overview") {
  clearTimeout(state.saveTimer);
  el.writer.hidden=true; el.workspace.hidden=false;
  el.workspace.classList.toggle("is-documents",view==="documents");
  document.querySelector("#overview-heading").hidden=view==="documents";
  document.querySelector(".hero-panel").hidden=view==="documents";
  document.querySelector(".stats-grid").hidden=view==="documents";
  document.querySelector(".page-footer").hidden=view==="documents";
  document.querySelector("#documents-heading").textContent=view==="documents"?"My documents":"Recent documents";
  document.querySelector(".section-subtitle").textContent=view==="documents"?"All documents stored in your local OrbOffice workspace.":"Your OrbOffice files, stored in your private workspace.";
  breadcrumb(view==="documents"?"My documents":"Overview"); nav(view);
  renderDocuments();
}
async function openWriter(id) {
  try {
    const item=await invoke("read_document",{id});
    clearTimeout(state.saveTimer);
    state.activeDocument=item; state.dirty=false;
    el.title.value=item.title; el.editor.innerHTML=cleanHtml(item.content);
    updateWordCount(); saveStatus("Saved");
    el.workspace.hidden=true; el.writer.hidden=false;
    breadcrumb("Orb Write"); nav("write"); el.editor.focus();
  } catch(error) { toast("Could not open document: "+error); }
}
async function saveDocument() {
  if (!state.activeDocument) return;
  clearTimeout(state.saveTimer);
  if (state.saving) {
    await state.saving;
    if (state.dirty) return saveDocument();
    return;
  }
  const title=el.title.value.trim(), content=cleanHtml(el.editor.innerHTML);
  if (!title) { saveStatus("Title required",true); el.title.focus(); return; }
  saveStatus("Saving…");
  const id=state.activeDocument.id;
  state.saving=invoke("update_document",{id,title,content}).then(async updated=>{
    state.activeDocument={...state.activeDocument,...updated,title,content};
    if (el.title.value.trim()===title && cleanHtml(el.editor.innerHTML)===content) {
      state.dirty=false; saveStatus("Saved");
    } else {
      state.dirty=true; saveStatus("Unsaved changes");
      state.saveTimer=setTimeout(()=>saveDocument(),300);
    }
    await loadDocuments(false);
  }).catch(error=>{
    state.dirty=true; saveStatus("Save failed",true); toast("Could not save document: "+error);
  }).finally(()=>{state.saving=null;});
  await state.saving;
}
async function closeWriter() {
  if (state.dirty) { await saveDocument(); if(state.dirty) return; }
  state.activeDocument=null; showWorkspace("overview");
}
function actionButton(action,label,icon,extra="") {
  const button=document.createElement("button");
  button.type="button"; button.className="row-action "+extra;
  button.setAttribute("aria-label",label); button.title=label; button.innerHTML=icon;
  button.addEventListener("click",()=>{});
  return button;
}
function renderDocuments() {
  if (!el.list) return;
  const query=el.search.value.trim().toLocaleLowerCase();
  const rows=state.documents.filter(item=>item.title.toLocaleLowerCase().includes(query));
  el.count.textContent=String(state.documents.length); el.sideCount.textContent=String(state.documents.length);
  el.list.replaceChildren();
  if (!rows.length) {
    const empty=document.createElement("div"); empty.className="empty-state";
    const icon=document.createElement("div"); icon.className="empty-icon"; icon.innerHTML=docIcon;
    const heading=document.createElement("h3"); heading.textContent=query?"No matching documents":"Your workspace is ready";
    const message=document.createElement("p"); message.textContent=query?"Try another search term.":"Create your first Orb Write document or import an existing .orbdoc file.";
    empty.append(icon,heading,message);
    if (!query) {
      const create=document.createElement("button"); create.type="button"; create.className="button button-primary";
      create.textContent="Create your first document"; create.addEventListener("click",createDocument); empty.append(create);
    }
    el.list.append(empty); return;
  }
  for(const item of rows) {
    const row=document.createElement("article"); row.className="document-row";
    const open=document.createElement("button"); open.type="button"; open.className="document-main"; open.addEventListener("click",()=>openWriter(item.id));
    const icon=document.createElement("span"); icon.className="file-icon"; icon.innerHTML=docIcon;
    const copy=document.createElement("span"); copy.className="file-copy";
    const title=document.createElement("strong"); title.textContent=item.title;
    const meta=document.createElement("span"); meta.textContent="Edited "+formatDate(item.modifiedAt)+" · "+item.characters+" characters";
    copy.append(title,meta); open.append(icon,copy);
    const kind=document.createElement("span"); kind.className="file-kind"; kind.textContent="ORB WRITE";
    const actions=document.createElement("div"); actions.className="row-actions";
    const rename=actionButton("rename","Rename document",'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/></svg>');
    const remove=actionButton("delete","Delete document",'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 1 13h9l1-13M10 10.5v6M14 10.5v6"/></svg>',"delete");
    rename.addEventListener("click",()=>showRename(item)); remove.addEventListener("click",()=>showDelete(item));
    actions.append(rename,remove); row.append(open,kind,actions); el.list.append(row);
  }
}
async function loadDocuments(loading=false) {
  if(loading) el.list.innerHTML='<div class="loading-state"><span class="spinner"></span> Loading your workspace…</div>';
  try { state.documents=await invoke("list_documents"); renderDocuments(); }
  catch(error) {
    el.list.replaceChildren(); const empty=document.createElement("div"); empty.className="empty-state";
    const heading=document.createElement("h3"); heading.textContent="Workspace could not be loaded";
    const detail=document.createElement("p"); detail.textContent=String(error); empty.append(heading,detail); el.list.append(empty);
    toast("Could not load the local workspace.");
  }
}
async function createDocument() {
  try { const created=await invoke("create_document"); await loadDocuments(false); await openWriter(created.id); }
  catch(error) { toast("Could not create document: "+error); }
}
async function importDocument() {
  try { const imported=await invoke("import_document"); if(!imported)return; await loadDocuments(false); await openWriter(imported.id); }
  catch(error) { toast("Import failed: "+error); }
}
function showRename(item) {
  state.renameTarget=item; el.renameInput.value=item.title; el.renameDialog.showModal(); el.renameInput.focus(); el.renameInput.select();
}
async function saveRename(event) {
  event.preventDefault(); if(!state.renameTarget)return;
  const title=el.renameInput.value.trim(); if(!title){el.renameInput.focus();return;}
  try {
    await invoke("rename_document",{id:state.renameTarget.id,title});
    el.renameDialog.close(); state.renameTarget=null; await loadDocuments(false); toast("Document renamed.");
  } catch(error) { toast("Rename failed: "+error); }
}
function showDelete(item) {
  state.deleteTarget=item; el.deleteMessage.textContent='"'+item.title+'" will be permanently removed from your OrbOffice workspace.';
  el.deleteDialog.showModal();
}
async function confirmDelete() {
  if(!state.deleteTarget)return;
  const id=state.deleteTarget.id;
  try {
    await invoke("delete_document",{id}); el.deleteDialog.close(); state.deleteTarget=null;
    if(state.activeDocument?.id===id) {state.activeDocument=null;el.writer.hidden=true;el.workspace.hidden=false;}
    await loadDocuments(false); toast("Document deleted from this device.");
  } catch(error) { toast("Delete failed: "+error); }
}

document.querySelector("#new-document-button").addEventListener("click",createDocument);
document.querySelector("#top-new-button").addEventListener("click",createDocument);
document.querySelector("#import-document-button").addEventListener("click",importDocument);
document.querySelector("#refresh-button").addEventListener("click",()=>loadDocuments(true));
document.querySelector("#rename-form").addEventListener("submit",saveRename);
document.querySelector("#delete-confirm-button").addEventListener("click",confirmDelete);
el.search.addEventListener("input",renderDocuments);
el.editor.addEventListener("input",markDirty); el.title.addEventListener("input",markDirty);
el.saveButton.addEventListener("click",saveDocument);
document.querySelector("#writer-back-button").addEventListener("click",closeWriter);
document.querySelectorAll(".writer-toolbar [data-command]").forEach(button=>button.addEventListener("click",()=>{
  el.editor.focus(); document.execCommand(button.dataset.command,false,button.dataset.value||null); markDirty();
}));
document.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>document.getElementById(button.dataset.close)?.close()));
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",async()=>{
  const view=button.dataset.view;
  if(state.activeDocument&&state.dirty){await saveDocument();if(state.dirty)return;}
  if(view==="write"){await createDocument();return;}
  state.activeDocument=null;showWorkspace(view);if(view==="documents")el.search.focus();
}));
document.addEventListener("keydown",event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"&&state.activeDocument){event.preventDefault();saveDocument();}
});
el.renameDialog.addEventListener("close",()=>{state.renameTarget=null;});
el.deleteDialog.addEventListener("close",()=>{state.deleteTarget=null;});
loadDocuments(true);
