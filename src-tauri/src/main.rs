#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const DOCUMENT_FORMAT: &str = "orb-office-document";
const DOCUMENT_VERSION: u32 = 1;
const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
static NEXT_DOCUMENT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    format: String,
    version: u32,
    id: String,
    title: String,
    content: String,
    created_at: u64,
    modified_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentSummary {
    id: String,
    title: String,
    created_at: u64,
    modified_at: u64,
    characters: usize,
    size_bytes: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn new_document_id() -> String {
    let sequence = NEXT_DOCUMENT_ID.fetch_add(1, Ordering::Relaxed);
    format!("doc-{}-{}", now_millis(), sequence)
}

fn documents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let directory = app_data.join("documents");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the OrbOffice workspace: {error}"))?;
    Ok(directory)
}

fn document_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let valid = id.starts_with("doc-")
        && id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-');
    if !valid {
        return Err("Invalid document identifier.".to_string());
    }
    Ok(documents_dir(app)?.join(format!("{id}.orbdoc")))
}

fn validate_document(document: &DocumentFile) -> Result<(), String> {
    if document.format != DOCUMENT_FORMAT || document.version != DOCUMENT_VERSION {
        return Err("This file is not a supported OrbOffice document.".to_string());
    }
    if document.title.trim().is_empty() || document.title.chars().count() > 80 {
        return Err("The document contains an invalid title.".to_string());
    }
    Ok(())
}

fn read_document_file(path: &Path) -> Result<DocumentFile, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("This document is larger than the current 16 MB limit.".to_string());
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let document: DocumentFile = serde_json::from_str(&contents)
        .map_err(|_| "The document file is damaged or invalid.".to_string())?;
    validate_document(&document)?;
    Ok(document)
}

fn write_document_file(path: &Path, document: &DocumentFile) -> Result<(), String> {
    validate_document(document)?;
    let contents = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    if contents.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("The document is larger than the current 16 MB limit.".to_string());
    }
    fs::write(path, contents).map_err(|error| format!("Could not save the document: {error}"))
}

fn summarize(document: &DocumentFile, path: &Path) -> DocumentSummary {
    let size_bytes = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
    DocumentSummary {
        id: document.id.clone(),
        title: document.title.clone(),
        created_at: document.created_at,
        modified_at: document.modified_at,
        characters: document.content.chars().count(),
        size_bytes,
    }
}

#[tauri::command]
fn list_documents(app: AppHandle) -> Result<Vec<DocumentSummary>, String> {
    let directory = documents_dir(&app)?;
    let entries = fs::read_dir(&directory).map_err(|error| error.to_string())?;
    let mut documents = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("orbdoc") {
            continue;
        }
        let Ok(document) = read_document_file(&path) else {
            // Leave damaged or unsupported files untouched and keep the workspace available.
            continue;
        };
        documents.push(summarize(&document, &path));
    }

    documents.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(documents)
}

#[tauri::command]
fn create_document(app: AppHandle) -> Result<DocumentSummary, String> {
    let id = new_document_id();
    let now = now_millis();
    let document = DocumentFile {
        format: DOCUMENT_FORMAT.to_string(),
        version: DOCUMENT_VERSION,
        id: id.clone(),
        title: "Untitled document".to_string(),
        content: String::new(),
        created_at: now,
        modified_at: now,
    };
    let path = document_path(&app, &id)?;
    write_document_file(&path, &document)?;
    Ok(summarize(&document, &path))
}

#[tauri::command]
fn import_document(app: AppHandle) -> Result<Option<DocumentSummary>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Import an OrbOffice document")
        .add_filter("OrbOffice document", &["orbdoc"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let source = selected
        .into_path()
        .map_err(|error| format!("Could not access the selected file: {error}"))?;
    let mut document = read_document_file(&source)?;

    // Import creates a private workspace copy. The selected source file is not changed.
    let id = new_document_id();
    let now = now_millis();
    document.id = id.clone();
    document.created_at = now;
    document.modified_at = now;

    let destination = document_path(&app, &id)?;
    write_document_file(&destination, &document)?;
    Ok(Some(summarize(&document, &destination)))
}

#[tauri::command]
fn read_document(app: AppHandle, id: String) -> Result<DocumentFile, String> {
    let path = document_path(&app, &id)?;
    let document = read_document_file(&path)?;
    if document.id != id {
        return Err("The document identifier does not match its file.".to_string());
    }
    Ok(document)
}

#[tauri::command]
fn rename_document(app: AppHandle, id: String, title: String) -> Result<DocumentSummary, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 80 || title.chars().any(char::is_control) {
        return Err("Use a name between 1 and 80 characters without control characters.".to_string());
    }

    let path = document_path(&app, &id)?;
    let mut document = read_document_file(&path)?;
    if document.id != id {
        return Err("The document identifier does not match its file.".to_string());
    }
    document.title = title.to_string();
    document.modified_at = now_millis();
    write_document_file(&path, &document)?;
    Ok(summarize(&document, &path))
}

#[tauri::command]
fn delete_document(app: AppHandle, id: String) -> Result<(), String> {
    let path = document_path(&app, &id)?;
    let document = read_document_file(&path)?;
    if document.id != id {
        return Err("The document identifier does not match its file.".to_string());
    }
    fs::remove_file(path).map_err(|error| format!("Could not delete the document: {error}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_documents,
            create_document,
            import_document,
            read_document,
            rename_document,
            delete_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running OrbOffice");
}
