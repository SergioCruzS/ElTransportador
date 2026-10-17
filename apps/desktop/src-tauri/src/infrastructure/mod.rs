//! Capa de Infraestructura de ElTransportador (`infrastructure/`).

use crate::domain::{
    CollectionFile, DomainError, CURRENT_SCHEMA_VERSION, SCHEMA_URI,
};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

pub struct ActiveRequestRegistry {
    cancelled: Mutex<HashMap<String, bool>>,
}

impl ActiveRequestRegistry {
    pub fn new() -> Self {
        Self {
            cancelled: Mutex::new(HashMap::new()),
        }
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        if let Ok(mut map) = self.cancelled.lock() {
            map.insert(request_id.to_string(), true);
            return true;
        }
        false
    }
}

pub struct AtomicCollectionStorage;

impl AtomicCollectionStorage {
    pub fn save_to_path(path: &Path, collection: &mut CollectionFile) -> Result<(), DomainError> {
        collection.schema = SCHEMA_URI.to_string();
        collection.schema_version = CURRENT_SCHEMA_VERSION;
        collection.kind = "eltransportador.collection".to_string();

        for var in &mut collection.variables {
            if var.is_secret {
                var.value = String::new();
            }
        }

        let serialized = serde_json::to_string_pretty(collection)
            .map_err(|e| DomainError::StorageError(e.to_string()))?;

        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|e| DomainError::StorageError(e.to_string()))?;

        let tmp_path = path.with_extension(format!("etp.json.tmp.{}", std::process::id()));
        let bak_path = path.with_extension("etp.json.bak");

        fs::write(&tmp_path, serialized.as_bytes())
            .map_err(|e| DomainError::StorageError(e.to_string()))?;

        if path.exists() {
            let _ = fs::copy(path, &bak_path);
        }

        fs::rename(&tmp_path, path).map_err(|e| DomainError::StorageError(e.to_string()))?;
        Ok(())
    }

    pub fn load_from_path(path: &Path) -> Result<CollectionFile, DomainError> {
        let raw = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(primary_err) => {
                let bak_path = path.with_extension("etp.json.bak");
                if bak_path.exists() {
                    fs::read_to_string(&bak_path).map_err(|_| {
                        DomainError::StorageError(format!(
                            "Error leyendo archivo principal ({}) y respaldo",
                            primary_err
                        ))
                    })?
                } else {
                    return Err(DomainError::StorageError(primary_err.to_string()));
                }
            }
        };

        let parsed: CollectionFile =
            serde_json::from_str(&raw).map_err(|e| DomainError::StorageError(e.to_string()))?;
        if parsed.kind != "eltransportador.collection" {
            return Err(DomainError::StorageError(
                "El archivo no corresponde al esquema eltransportador.collection".into(),
            ));
        }
        Ok(parsed)
    }
}
