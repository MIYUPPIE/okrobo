//! Project storage: a SQLite index plus one directory per project.
//!
//! Layout under the app data dir:
//!   projects.db                       index (id, name, timestamps)
//!   projects/<id>/blocks.json         Blockly workspace serialization
//!   projects/<id>/program.py          the Python buffer
//!   projects/<id>/project.json        {world, python_edited}

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectPayload {
    /// Blockly workspace serialization (opaque to the shell).
    pub blocks: serde_json::Value,
    pub python: String,
    /// true when the user edited the Python by hand (stops blocks sync).
    pub python_edited: bool,
    /// world name from packs, e.g. "arena".
    pub world: String,
}

#[derive(Serialize, Deserialize)]
struct SideMeta {
    world: String,
    python_edited: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct Store {
    root: PathBuf,
    db: Connection,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("projects")).map_err(|e| e.to_string())?;
        let db = Connection::open(root.join("projects.db")).map_err(|e| e.to_string())?;
        db.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(Store { root, db })
    }

    fn dir(&self, id: &str) -> PathBuf {
        self.root.join("projects").join(id)
    }

    pub fn list(&self) -> Result<Vec<ProjectMeta>, String> {
        let mut statement = self
            .db
            .prepare("SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ProjectMeta {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn create(&self, name: &str, payload: &ProjectPayload) -> Result<ProjectMeta, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("project name is empty".into());
        }
        let meta = ProjectMeta {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            created_at: now(),
            updated_at: now(),
        };
        self.write_payload(&meta.id, payload)?;
        self.db
            .execute(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                (&meta.id, &meta.name, meta.created_at, meta.updated_at),
            )
            .map_err(|e| e.to_string())?;
        Ok(meta)
    }

    pub fn save(&self, id: &str, payload: &ProjectPayload) -> Result<ProjectMeta, String> {
        self.write_payload(id, payload)?;
        let updated = now();
        let changed = self
            .db
            .execute(
                "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
                (updated, id),
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("no project with id {id}"));
        }
        self.meta(id)
    }

    pub fn load(&self, id: &str) -> Result<(ProjectMeta, ProjectPayload), String> {
        let meta = self.meta(id)?;
        let dir = self.dir(id);
        let blocks: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join("blocks.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let python = fs::read_to_string(dir.join("program.py")).map_err(|e| e.to_string())?;
        let side: SideMeta = serde_json::from_str(
            &fs::read_to_string(dir.join("project.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok((
            meta,
            ProjectPayload {
                blocks,
                python,
                python_edited: side.python_edited,
                world: side.world,
            },
        ))
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM projects WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        let dir = self.dir(id);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn meta(&self, id: &str) -> Result<ProjectMeta, String> {
        self.db
            .query_row(
                "SELECT id, name, created_at, updated_at FROM projects WHERE id = ?1",
                [id],
                |row| {
                    Ok(ProjectMeta {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .map_err(|e| e.to_string())
    }

    fn write_payload(&self, id: &str, payload: &ProjectPayload) -> Result<(), String> {
        let dir = self.dir(id);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(
            dir.join("blocks.json"),
            serde_json::to_string_pretty(&payload.blocks).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(dir.join("program.py"), &payload.python).map_err(|e| e.to_string())?;
        let side = SideMeta {
            world: payload.world.clone(),
            python_edited: payload.python_edited,
        };
        fs::write(
            dir.join("project.json"),
            serde_json::to_string_pretty(&side).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(python: &str) -> ProjectPayload {
        ProjectPayload {
            blocks: serde_json::json!({"blocks": {"languageVersion": 0, "blocks": []}}),
            python: python.to_string(),
            python_edited: false,
            world: "arena".to_string(),
        }
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().to_path_buf()).unwrap();
        (dir, store)
    }

    #[test]
    fn create_load_roundtrip() {
        let (_dir, store) = store();
        let meta = store.create("My Robot", &payload("robot.forward()")).unwrap();
        let (loaded_meta, loaded) = store.load(&meta.id).unwrap();
        assert_eq!(loaded_meta.name, "My Robot");
        assert_eq!(loaded.python, "robot.forward()");
        assert_eq!(loaded.world, "arena");
        assert!(!loaded.python_edited);
    }

    #[test]
    fn save_updates_content_and_timestamp() {
        let (_dir, store) = store();
        let meta = store.create("P", &payload("a")).unwrap();
        let mut updated = payload("b");
        updated.python_edited = true;
        let saved = store.save(&meta.id, &updated).unwrap();
        assert!(saved.updated_at >= meta.updated_at);
        let (_, loaded) = store.load(&meta.id).unwrap();
        assert_eq!(loaded.python, "b");
        assert!(loaded.python_edited);
    }

    #[test]
    fn list_orders_by_recency() {
        let (_dir, store) = store();
        let first = store.create("first", &payload("")).unwrap();
        let second = store.create("second", &payload("")).unwrap();
        // Touch the first so it becomes most recent (timestamps are seconds,
        // so force a distinct value through a direct update).
        store
            .db
            .execute(
                "UPDATE projects SET updated_at = updated_at + 10 WHERE id = ?1",
                [&first.id],
            )
            .unwrap();
        let names: Vec<String> = store.list().unwrap().into_iter().map(|m| m.name).collect();
        assert_eq!(names, vec!["first".to_string(), "second".to_string()]);
        assert_eq!(store.list().unwrap().len(), 2);
        let _ = second;
    }

    #[test]
    fn empty_name_rejected() {
        let (_dir, store) = store();
        assert!(store.create("   ", &payload("")).is_err());
    }

    #[test]
    fn save_unknown_id_fails() {
        let (_dir, store) = store();
        assert!(store.save("nope", &payload("")).is_err());
    }

    #[test]
    fn delete_removes_row_and_files() {
        let (_dir, store) = store();
        let meta = store.create("gone", &payload("x")).unwrap();
        let project_dir = store.dir(&meta.id);
        assert!(project_dir.exists());
        store.delete(&meta.id).unwrap();
        assert!(!project_dir.exists());
        assert!(store.list().unwrap().is_empty());
        assert!(store.load(&meta.id).is_err());
    }
}
