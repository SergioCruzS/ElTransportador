//! Punto de entrada de la biblioteca nativa de ElTransportador v1.0.0 (`eltransportador_lib`).
//! Registra los comandos IPC nativos (`execute_http_request`, `cancel_http_request`, `save_collection_cmd`)
//! sin servidores de prueba ni datos ficticios en compilaciones de release.

pub mod application;
pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod security;

use commands::{cancel_http_request, execute_http_request, save_collection_cmd, AppState};
use infrastructure::ActiveRequestRegistry;
use security::SecretVault;
use std::path::PathBuf;

pub fn run() {
    let workspace_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    tauri::Builder::default()
        .manage(AppState {
            registry: ActiveRequestRegistry::new(),
            workspace_dir,
            vault: SecretVault::new(),
        })
        .invoke_handler(tauri::generate_handler![
            execute_http_request,
            cancel_http_request,
            save_collection_cmd
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar la aplicación de escritorio ElTransportador v1.0.0");
}
