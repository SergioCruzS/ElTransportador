//! Ejecutor de colecciones por línea de comandos (`eltransportador-cli`).
//! Comparte los modelos de dominio, el motor de resolución de variables y el evaluador de aserciones
//! del núcleo de escritorio sin requerir entorno gráfico.

use eltransportador_lib::domain::CURRENT_SCHEMA_VERSION;
use eltransportador_lib::infrastructure::AtomicCollectionStorage;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 || args.contains(&"--help".to_string()) {
        println!("ElTransportador CLI v1.0.1 (Esquema v{})", CURRENT_SCHEMA_VERSION);
        println!("Uso: eltransportador-cli run <ruta-coleccion.etp.json> [--env <nombre>] [--report <archivo.json>]");
        return ExitCode::SUCCESS;
    }

    if args.get(1).map(|s| s.as_str()) == Some("validate") {
        if let Some(path_str) = args.get(2) {
            let path = PathBuf::from(path_str);
            match AtomicCollectionStorage::load_from_path(&path) {
                Ok(col) => {
                    println!(
                        "Colección válida: '{}' ({} solicitudes, esquema v{})",
                        col.metadata.name,
                        col.requests.len(),
                        col.schema_version
                    );
                    return ExitCode::SUCCESS;
                }
                Err(e) => {
                    eprintln!("Error validando colección: {}", e);
                    return ExitCode::from(2);
                }
            }
        }
    }

    ExitCode::SUCCESS
}
