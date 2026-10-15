//! Engine database (P4): the sqlite port of the TS engine. Tables and migrations belong to the
//! engine (`packages/engine/src/store/schema.ts`); Rust only opens the file and runs statements.
//! A group of statements runs in one real transaction and rolls back as a whole when any fails.
use crate::runtime_paths;
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use sqlx::sqlite::{
    SqliteArguments, SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions,
    SqliteRow,
};
use sqlx::{
    Column, ConnectOptions, Connection, Row, Sqlite, SqlitePool, Transaction, TypeInfo, ValueRef,
};
use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::OnceCell;

pub const ENGINE_DB_FILE: &str = "storyforge-engine.sqlite3";
/// The Python sidecar's database, next to the engine database (read once by the P4-3 import).
pub const PYTHON_DB_FILE: &str = "storyforge.sqlite3";

type Rows = Vec<Map<String, Value>>;
type Query<'q> = sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>;

#[derive(Default)]
pub struct EngineDbState(OnceCell<SqlitePool>);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineDbStep {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

pub(crate) async fn open(path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    // One connection: the engine is the only reader and writer, statements run in arrival
    // order and a read issued during a transaction waits for it.
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("无法打开引擎库：{error}"))
}

/// Integers bind as INTEGER and other numbers as REAL (the engine never binds booleans,
/// arrays or objects: booleans are stored as 0 / 1 and JSON columns as text).
fn bind<'q>(mut query: Query<'q>, params: &[Value]) -> Result<Query<'q>, String> {
    for (index, value) in params.iter().enumerate() {
        query = match value {
            Value::Null => query.bind(None::<i64>),
            Value::String(text) => query.bind(text.clone()),
            Value::Number(number) => match number.as_i64() {
                Some(integer) => query.bind(integer),
                None => query.bind(number.as_f64().unwrap_or(f64::NAN)),
            },
            _ => {
                return Err(format!(
                    "引擎库第 {} 个参数不是文本、数字或 NULL",
                    index + 1
                ))
            }
        };
    }
    Ok(query)
}

/// Columns decode by the stored value's own type, not the declared column type.
fn row_json(row: &SqliteRow) -> Result<Map<String, Value>, String> {
    let mut output = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(|error| error.to_string())?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            let kind = raw.type_info().name().to_string();
            match kind.as_str() {
                "INTEGER" => Value::from(row.try_get::<i64, _>(index).map_err(|e| e.to_string())?),
                "REAL" => {
                    let real = row.try_get::<f64, _>(index).map_err(|e| e.to_string())?;
                    Value::Number(
                        Number::from_f64(real)
                            .ok_or_else(|| format!("引擎库列 {} 不是有限数字", column.name()))?,
                    )
                }
                "TEXT" => {
                    Value::String(row.try_get::<String, _>(index).map_err(|e| e.to_string())?)
                }
                other => return Err(format!("引擎库列 {} 是不支持的类型 {other}", column.name())),
            }
        };
        output.insert(column.name().to_string(), value);
    }
    Ok(output)
}

pub(crate) async fn select(pool: &SqlitePool, sql: &str, params: &[Value]) -> Result<Rows, String> {
    let rows = bind(sqlx::query(sql), params)?
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    rows.iter().map(row_json).collect()
}

async fn run_steps(
    tx: &mut Transaction<'_, Sqlite>,
    steps: &[EngineDbStep],
) -> Result<Rows, String> {
    let mut last = Vec::new();
    for step in steps {
        let rows = bind(sqlx::query(&step.sql), &step.params)?
            .fetch_all(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
        last = rows.iter().map(row_json).collect::<Result<_, _>>()?;
    }
    Ok(last)
}

/// Returns the rows of the last statement; earlier statements' rows are dropped.
pub(crate) async fn transaction(pool: &SqlitePool, steps: &[EngineDbStep]) -> Result<Rows, String> {
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    match run_steps(&mut tx, steps).await {
        Ok(rows) => {
            tx.commit().await.map_err(|error| error.to_string())?;
            Ok(rows)
        }
        Err(error) => {
            tx.rollback()
                .await
                .map_err(|rollback| format!("{error}；回滚失败：{rollback}"))?;
            Err(error)
        }
    }
}

async fn read_all(
    connection: &mut SqliteConnection,
    queries: &[String],
) -> Result<Vec<Rows>, String> {
    let mut tx = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let mut sets = Vec::with_capacity(queries.len());
    for sql in queries {
        let rows = sqlx::query(sql)
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sets.push(rows.iter().map(row_json).collect::<Result<_, _>>()?);
    }
    tx.rollback().await.map_err(|error| error.to_string())?;
    Ok(sets)
}

/// Reads the Python database for the one-time import (P4-3). Opened read-only, so the driver
/// refuses any write (also one placed after a SELECT); never created and its journal mode is
/// left alone. All queries run in one read transaction: one snapshot while the sidecar may be
/// writing. `None` when the file does not exist.
pub(crate) async fn python_snapshot(
    path: &Path,
    queries: &[String],
) -> Result<Option<Vec<Rows>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let mut connection = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .busy_timeout(Duration::from_secs(5))
        .connect()
        .await
        .map_err(|error| format!("无法只读打开旧库：{error}"))?;
    let sets = read_all(&mut connection, queries).await;
    let closed = connection.close().await;
    let sets = sets?;
    closed.map_err(|error| error.to_string())?;
    Ok(Some(sets))
}

/// Scratch databases (P5-1 shadow mode): in memory, one connection each that is never recycled
/// (the database lives as long as that connection), gone on close. A handful at most, so a
/// caller that forgets to close cannot pile them up.
#[derive(Default)]
pub struct EngineScratchState {
    next: AtomicU64,
    pools: Mutex<HashMap<u64, SqlitePool>>,
}

pub const MAX_SCRATCH_DBS: usize = 4;

impl EngineScratchState {
    fn pools(&self) -> std::sync::MutexGuard<'_, HashMap<u64, SqlitePool>> {
        self.pools
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) async fn open(&self) -> Result<u64, String> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .map_err(|error| error.to_string())?
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options)
            .await
            .map_err(|error| format!("无法打开临时库：{error}"))?;
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let refused = {
            let mut pools = self.pools();
            if pools.len() >= MAX_SCRATCH_DBS {
                true
            } else {
                pools.insert(id, pool.clone());
                false
            }
        };
        if refused {
            pool.close().await;
            return Err(format!("临时库已开到上限 {MAX_SCRATCH_DBS} 个"));
        }
        Ok(id)
    }

    pub(crate) fn get(&self, id: u64) -> Result<SqlitePool, String> {
        self.pools()
            .get(&id)
            .cloned()
            .ok_or_else(|| "临时库不存在或已关闭".to_string())
    }

    /// Closing an unknown or already closed id is not an error.
    pub(crate) async fn close(&self, id: u64) {
        let pool = self.pools().remove(&id);
        if let Some(pool) = pool {
            pool.close().await;
        }
    }
}

async fn pool<'a>(app: &AppHandle, state: &'a EngineDbState) -> Result<&'a SqlitePool, String> {
    state
        .0
        .get_or_try_init(|| async {
            let dir = runtime_paths::app_local_data_dir(app).map_err(|error| error.to_string())?;
            std::fs::create_dir_all(&dir)
                .map_err(|error| format!("无法创建应用数据目录：{error}"))?;
            open(&dir.join(ENGINE_DB_FILE)).await
        })
        .await
}

#[tauri::command]
pub async fn engine_db_select(
    app: AppHandle,
    state: State<'_, EngineDbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Rows, String> {
    select(pool(&app, &state).await?, &sql, &params).await
}

#[tauri::command]
pub async fn engine_db_transaction(
    app: AppHandle,
    state: State<'_, EngineDbState>,
    steps: Vec<EngineDbStep>,
) -> Result<Rows, String> {
    transaction(pool(&app, &state).await?, &steps).await
}

#[tauri::command]
pub async fn engine_python_db_snapshot(
    app: AppHandle,
    queries: Vec<String>,
) -> Result<Option<Vec<Rows>>, String> {
    let dir = runtime_paths::app_local_data_dir(&app).map_err(|error| error.to_string())?;
    python_snapshot(&dir.join(PYTHON_DB_FILE), &queries).await
}

#[tauri::command]
pub async fn engine_scratch_db_open(state: State<'_, EngineScratchState>) -> Result<u64, String> {
    state.open().await
}

#[tauri::command]
pub async fn engine_scratch_db_select(
    state: State<'_, EngineScratchState>,
    id: u64,
    sql: String,
    params: Vec<Value>,
) -> Result<Rows, String> {
    select(&state.get(id)?, &sql, &params).await
}

#[tauri::command]
pub async fn engine_scratch_db_transaction(
    state: State<'_, EngineScratchState>,
    id: u64,
    steps: Vec<EngineDbStep>,
) -> Result<Rows, String> {
    transaction(&state.get(id)?, &steps).await
}

#[tauri::command]
pub async fn engine_scratch_db_close(
    state: State<'_, EngineScratchState>,
    id: u64,
) -> Result<(), String> {
    state.close(id).await;
    Ok(())
}

#[cfg(test)]
#[path = "engine_db_tests.rs"]
mod tests;
