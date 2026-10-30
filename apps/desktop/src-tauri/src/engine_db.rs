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
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::OnceCell;

pub const ENGINE_DB_FILE: &str = "storyforge-engine.sqlite3";
/// The Python sidecar's database, next to the engine database (read once by the P4-3 import).
pub const PYTHON_DB_FILE: &str = "storyforge.sqlite3";
/// 升级前的整库副本与引擎库并排，名字里的时间戳让字典序就是先后序。
const BACKUP_PREFIX: &str = "storyforge-engine.backup-";
const BACKUP_SUFFIX: &str = ".sqlite3";
const BACKUPS_KEPT: usize = 3;

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

/// 引擎升级库结构前的整库副本。`VACUUM INTO` 写出一致的副本（含还没 checkpoint 的 WAL 行），
/// 先写到 `.pending` 再改名：写到一半崩掉的副本不会顶着备份的名字。
pub(crate) async fn backup(pool: &SqlitePool, dir: &Path, label: &str) -> Result<PathBuf, String> {
    let target = dir.join(format!("{BACKUP_PREFIX}{label}{BACKUP_SUFFIX}"));
    let pending = dir.join(format!("{BACKUP_PREFIX}{label}{BACKUP_SUFFIX}.pending"));
    let _ = std::fs::remove_file(&pending);
    let pending_text = pending.to_str().ok_or("备份引擎库失败：路径不是合法文本")?;
    sqlx::query("VACUUM INTO $1")
        .bind(pending_text)
        .execute(pool)
        .await
        .map_err(|error| format!("备份引擎库失败：{error}"))?;
    std::fs::rename(&pending, &target).map_err(|error| format!("备份引擎库失败：{error}"))?;
    Ok(target)
}

/// 只留最新的 `kept` 份副本，顺手清掉崩溃留下的 `.pending`。
pub(crate) fn prune_backups(dir: &Path, kept: usize) -> std::io::Result<()> {
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let name = entry?.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(BACKUP_PREFIX) {
            continue;
        }
        if name.ends_with(".pending") {
            std::fs::remove_file(dir.join(name))?;
        } else if name.ends_with(BACKUP_SUFFIX) {
            backups.push(name.to_string());
        }
    }
    backups.sort();
    let excess = backups.len().saturating_sub(kept);
    for name in &backups[..excess] {
        std::fs::remove_file(dir.join(name))?;
    }
    Ok(())
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

/// 引擎把已有的库从 `from_version` 升到 `to_version` 之前调用；失败时引擎不迁移。
#[tauri::command]
pub async fn engine_db_backup(
    app: AppHandle,
    state: State<'_, EngineDbState>,
    from_version: u32,
    to_version: u32,
) -> Result<(), String> {
    if from_version == 0 || from_version >= to_version {
        return Err(format!(
            "引擎库备份的版本号不对：{from_version} → {to_version}"
        ));
    }
    let pool = pool(&app, &state).await?;
    let dir = runtime_paths::app_local_data_dir(&app).map_err(|error| error.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    backup(
        pool,
        &dir,
        &format!("{stamp}-v{from_version}-to-v{to_version}"),
    )
    .await?;
    // 删旧副本失败只是多占点地方，不该挡住升级。
    let _ = prune_backups(&dir, BACKUPS_KEPT);
    Ok(())
}

#[cfg(test)]
#[path = "engine_db_tests.rs"]
mod tests;
