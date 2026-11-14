const invoke = (...args) => {
  const api = window.__TAURI__?.core?.invoke;
  if (!api) throw new Error("OrbOffice must be run as a desktop application.");
  return api(...args);
};

const state = { documents: [], renameTarget: null, deleteTarget: null, toastTimer: null };
const el = {
  count: document.querySelector("#document-count"),
  sideCount: document.querySelector("#sidebar-count"),
  list: document.querySelector("#documents-container"),
  search: document.querySelector("#search-input"),
  toast: document.querySelector("#toast"),
  renameDialog: document.querySelector("#rename-dialog"),
  renameInput: document.querySelector("#rename-input"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteMessage: document.querySelector("#delete-message"),
  previewDialog: document.querySelector("#preview-dialog"),
  previewTitle: document.querySelector("#preview-title"),
  previewMeta: document.querySelector("#preview-meta"),
  previewContent: document.querySelector("#preview-content"),
};

const documentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z"/><path d="M14 3.9v4.4h4.1M8.5 12h7M8.5 15.5h7"/></svg>';

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 2600);
}

function formatDate(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function actionButton(action, label, icon, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-action " + (extraClass || "");
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

function renderDocuments() {
  const query = el.search.value.trim().toLocaleLowerCase();
  const matching = state.documents.filter((item) => item.title.toLocaleLowerCase().includes(query));
  el.count.textContent = String(state.documents.length);
  el.sideCount.textContent = String(state.documents.length);
  el.list.replaceChildren();

  if (matching.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.innerHTML = documentIcon;
    const heading = document.createElement("h3");
    heading.textContent = query ? "No matching documents" : "Your workspace is ready";
    const message = document.createElement("p");
    message.textContent = query
      ? "Try another search term."
      : "Create your first OrbOffice document or import an existing .orbdoc file to get started.";
    empty.append(icon, heading, message);

    if (!query) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-primary";
      button.textContent = "Create your first document";
      button.addEventListener("click", createDocument);
      empty.append(button);
    }
    el.list.append(empty);
    return;
  }

  for (const item of matching) {
    const row = document.createElement("article");
    row.className = "document-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "document-main";
    open.addEventListener("click", () => previewDocument(item.id));

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = documentIcon;
    const copy = document.createElement("span");
    copy.className = "file-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = "Edited " + formatDate(item.modifiedAt) + " · " + item.characters + " characters";
    copy.append(title, meta);
    open.append(icon, copy);

    const kind = document.createElement("span");
    kind.className = "file-kind";
    kind.textContent = "ORBDOC";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const rename = actionButton("rename", "Rename document",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/></svg>');
    const remove = actionButton("delete", "Delete document",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 1 13h9l1-13M10 10.5v6M14 10.5v6"/></svg>', "delete");
    rename.addEventListener("click", () => showRename(item));
    remove.addEventListener("click", () => showDelete(item));
    actions.append(rename, remove);
    row.append(open, kind, actions);
    el.list.append(row);
  }
}

async function loadDocuments(showLoading) {
  if (showLoading) {
    el.list.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading your workspace…</div>';
  }
  try {
    state.documents = await invoke("list_documents");
    renderDocuments();
  } catch (error) {
    el.list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const heading = document.createElement("h3");
    heading.textContent = "Workspace could not be loaded";
    const detail = document.createElement("p");
    detail.textContent = String(error);
    empty.append(heading, detail);
    el.list.append(empty);
    toast("Could not load the local workspace.");
  }
}

async function createDocument() {
  try {
    const created = await invoke("create_document");
    await loadDocuments(false);
    toast("A new document was added to your workspace.");
    await previewDocument(created.id);
  } catch (error) {
    toast("Could not create document: " + error);
  }
}

async function importDocument() {
  try {
    const imported = await invoke("import_document");
    if (!imported) return;
    await loadDocuments(false);
    toast("Document imported into your local workspace.");
    await previewDocument(imported.id);
  } catch (error) {
    toast("Import failed: " + error);
  }
}

async function previewDocument(id) {
  try {
    const item = await invoke("read_document", { id });
    el.previewTitle.textContent = item.title;
    el.previewMeta.textContent = "OrbOffice document · Edited " + formatDate(item.modifiedAt);
    const content = item.content.trim();
    el.previewContent.textContent = content
      ? content.slice(0, 4000)
      : "This document is safely stored and ready for the OrbWriter editing module. The editor is being developed as a separate milestone.";
    el.previewDialog.showModal();
  } catch (error) {
    toast("Could not open document: " + error);
  }
}

function showRename(item) {
  state.renameTarget = item;
  el.renameInput.value = item.title;
  el.renameDialog.showModal();
  el.renameInput.focus();
  el.renameInput.select();
}

async function saveRename(event) {
  event.preventDefault();
  if (!state.renameTarget) return;
  const title = el.renameInput.value.trim();
  if (!title) {
    el.renameInput.focus();
    return;
  }
  try {
    await invoke("rename_document", { id: state.renameTarget.id, title });
    el.renameDialog.close();
    state.renameTarget = null;
    await loadDocuments(false);
    toast("Document renamed.");
  } catch (error) {
    toast("Rename failed: " + error);
  }
}

function showDelete(item) {
  state.deleteTarget = item;
  el.deleteMessage.textContent = '"' + item.title + '" will be permanently removed from your OrbOffice workspace.';
  el.deleteDialog.showModal();
}

async function confirmDelete() {
  if (!state.deleteTarget) return;
  try {
    await invoke("delete_document", { id: state.deleteTarget.id });
    el.deleteDialog.close();
    el.previewDialog.close();
    state.deleteTarget = null;
    await loadDocuments(false);
    toast("Document deleted from this device.");
  } catch (error) {
    toast("Delete failed: " + error);
  }
}

document.querySelector("#new-document-button").addEventListener("click", createDocument);
document.querySelector("#top-new-button").addEventListener("click", createDocument);
document.querySelector("#import-document-button").addEventListener("click", importDocument);
document.querySelector("#refresh-button").addEventListener("click", () => loadDocuments(true));
document.querySelector("#rename-form").addEventListener("submit", saveRename);
document.querySelector("#delete-confirm-button").addEventListener("click", confirmDelete);
el.search.addEventListener("input", renderDocuments);

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.close)?.close());
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const documentsView = button.dataset.view === "documents";
    document.querySelector("#breadcrumb-current").textContent = documentsView ? "My documents" : "Overview";
    document.querySelector("#documents-heading").textContent = documentsView ? "My documents" : "Recent documents";
    if (documentsView) {
      document.querySelector("#documents-section").scrollIntoView({ behavior: "smooth", block: "start" });
      el.search.focus();
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
});

el.renameDialog.addEventListener("close", () => { state.renameTarget = null; });
el.deleteDialog.addEventListener("close", () => { state.deleteTarget = null; });
loadDocuments(true);
