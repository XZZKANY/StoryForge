use super::*;
use serde_json::json;

async fn temp_db() -> (tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().unwrap();
    let pool = open(&dir.path().join(ENGINE_DB_FILE)).await.unwrap();
    (dir, pool)
}

fn step(sql: &str, params: Value) -> EngineDbStep {
    serde_json::from_value(json!({ "sql": sql, "params": params })).unwrap()
}

async fn setup(pool: &SqlitePool) {
    transaction(
        pool,
        &[
            step("CREATE TABLE parent (id INTEGER PRIMARY KEY, title TEXT NOT NULL)", json!([])),
            step(
                "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), \
                 flag BOOLEAN NOT NULL, at DATETIME NOT NULL, cost NUMERIC, body JSON)",
                json!([]),
            ),
        ],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn binds_by_number_per_step_and_returns_the_last_statement_rows() {
    let (_dir, pool) = temp_db().await;
    setup(&pool).await;
    let rows = transaction(
        &pool,
        &[
            step(
                "INSERT INTO parent (id, title) VALUES ($1, $2) RETURNING id",
                json!([1, "a"]),
            ),
            step(
                "INSERT INTO parent (id, title) VALUES ($2, $1)",
                json!(["b", 2]),
            ),
            step(
                "SELECT id, title FROM parent WHERE id >= $1 ORDER BY id",
                json!([1]),
            ),
        ],
    )
    .await
    .unwrap();
    assert_eq!(
        Value::Array(rows.into_iter().map(Value::Object).collect()),
        json!([{ "id": 1, "title": "a" }, { "id": 2, "title": "b" }])
    );
    let none = transaction(
        &pool,
        &[step(
            "UPDATE parent SET title = $1 WHERE id = $2",
            json!(["c", 1]),
        )],
    )
    .await
    .unwrap();
    assert!(none.is_empty());
}

#[tokio::test]
async fn decodes_by_stored_type_not_declared_type() {
    let (_dir, pool) = temp_db().await;
    setup(&pool).await;
    transaction(
        &pool,
        &[
            step("INSERT INTO parent (id, title) VALUES ($1, $2)", json!([1, "p"])),
            step(
                "INSERT INTO child (id, parent_id, flag, at, cost, body) VALUES ($1, $2, $3, $4, $5, $6), \
                 ($7, $2, $8, $4, $9, $10)",
                json!([1, 1, 1, "2026-10-14T00:00:00Z", 2.5, "{\"a\":2.0}", 2, 0, 3, null]),
            ),
        ],
    )
    .await
    .unwrap();
    let rows = select(
        &pool,
        "SELECT id, flag, at, cost, body, typeof(cost) AS cost_type, $1 AS echoed FROM child ORDER BY id",
        &[json!(7)],
    )
    .await
    .unwrap();
    assert_eq!(
        Value::Array(rows.into_iter().map(Value::Object).collect()),
        json!([
            { "id": 1, "flag": 1, "at": "2026-10-14T00:00:00Z", "cost": 2.5, "body": "{\"a\":2.0}",
              "cost_type": "real", "echoed": 7 },
            { "id": 2, "flag": 0, "at": "2026-10-14T00:00:00Z", "cost": 3, "body": null,
              "cost_type": "integer", "echoed": 7 }
        ])
    );
    // Integers bind as INTEGER: a number in a text column reads back as "5", not "5.0".
    let echoed = select(
        &pool,
        "SELECT typeof($1) AS a, typeof($2) AS b, CAST($1 AS TEXT) AS c",
        &[json!(5), json!(0.5)],
    )
    .await
    .unwrap();
    assert_eq!(
        Value::Object(echoed[0].clone()),
        json!({ "a": "integer", "b": "real", "c": "5" })
    );
}

#[tokio::test]
async fn a_failing_statement_rolls_the_whole_group_back() {
    let (_dir, pool) = temp_db().await;
    setup(&pool).await;
    let error = transaction(
        &pool,
        &[
            step(
                "INSERT INTO parent (id, title) VALUES ($1, $2)",
                json!([1, "kept?"]),
            ),
            step(
                "INSERT INTO child (id, parent_id, flag, at) VALUES (1, $1, 0, 't')",
                json!([99]),
            ),
        ],
    )
    .await
    .unwrap_err();
    assert!(error.contains("FOREIGN KEY"), "{error}");
    assert!(select(&pool, "SELECT id FROM parent", &[])
        .await
        .unwrap()
        .is_empty());
    // The single connection is usable again and outside any transaction.
    transaction(
        &pool,
        &[step(
            "INSERT INTO parent (id, title) VALUES (1, 'ok')",
            json!([]),
        )],
    )
    .await
    .unwrap();
    let bad_param = transaction(
        &pool,
        &[
            step(
                "INSERT INTO parent (id, title) VALUES (2, 'gone')",
                json!([]),
            ),
            step("SELECT $1", json!([true])),
        ],
    )
    .await
    .unwrap_err();
    assert!(bad_param.contains("第 1 个参数"), "{bad_param}");
    assert_eq!(
        select(&pool, "SELECT id FROM parent", &[])
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn reopening_keeps_committed_rows_and_unknown_step_keys_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(ENGINE_DB_FILE);
    let pool = open(&path).await.unwrap();
    setup(&pool).await;
    transaction(
        &pool,
        &[step(
            "INSERT INTO parent (id, title) VALUES (1, '长')",
            json!([]),
        )],
    )
    .await
    .unwrap();
    pool.close().await;
    let reopened = open(&path).await.unwrap();
    let rows = select(&reopened, "SELECT title FROM parent", &[])
        .await
        .unwrap();
    assert_eq!(rows[0]["title"], json!("长"));
    let journal = select(&reopened, "PRAGMA journal_mode", &[]).await.unwrap();
    assert_eq!(journal[0]["journal_mode"], json!("wal"));
    assert!(
        serde_json::from_value::<EngineDbStep>(json!({ "sql": "SELECT 1", "extra": 1 })).is_err()
    );
}

#[tokio::test]
async fn blobs_are_refused_instead_of_guessed() {
    let (_dir, pool) = temp_db().await;
    let error = select(&pool, "SELECT X'00' AS b", &[]).await.unwrap_err();
    assert!(error.contains("不支持的类型 BLOB"), "{error}");
}

fn digest(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap_or_default()
}

#[tokio::test]
async fn python_snapshot_is_none_for_a_missing_file_and_never_creates_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PYTHON_DB_FILE);
    assert!(python_snapshot(&path, &["SELECT 1".to_string()])
        .await
        .unwrap()
        .is_none());
    assert!(!path.exists());
}

#[tokio::test]
async fn python_snapshot_reads_uncheckpointed_wal_rows_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PYTHON_DB_FILE);
    // The sidecar's writer stays open in WAL mode: its rows live only in the -wal file.
    let writer = open(&path).await.unwrap();
    setup(&writer).await;
    transaction(
        &writer,
        &[step(
            "INSERT INTO parent (id, title) VALUES (1, '旧'), (2, '库')",
            json!([]),
        )],
    )
    .await
    .unwrap();
    let wal = dir.path().join(format!("{PYTHON_DB_FILE}-wal"));
    let before = (digest(&path), digest(&wal));
    assert!(!before.1.is_empty());

    let sets = python_snapshot(
        &path,
        &[
            "SELECT id, title FROM parent ORDER BY id".to_string(),
            "SELECT COUNT(*) AS n FROM parent".to_string(),
        ],
    )
    .await
    .unwrap()
    .unwrap();
    let sets: Vec<Value> = sets
        .into_iter()
        .map(|rows| Value::Array(rows.into_iter().map(Value::Object).collect()))
        .collect();
    assert_eq!(
        sets,
        vec![
            json!([{ "id": 1, "title": "旧" }, { "id": 2, "title": "库" }]),
            json!([{ "n": 2 }])
        ]
    );

    // The driver refuses writes, also one placed after a SELECT in the same query.
    let error = python_snapshot(&path, &["SELECT 1; DELETE FROM parent".to_string()])
        .await
        .unwrap_err();
    assert!(error.contains("readonly"), "{error}");
    // Whatever a journal-mode change returns, the files and the mode stay as they were.
    let _ = python_snapshot(&path, &["PRAGMA journal_mode = DELETE".to_string()]).await;
    assert_eq!((digest(&path), digest(&wal)), before);
    assert_eq!(
        select(&writer, "PRAGMA journal_mode", &[]).await.unwrap()[0]["journal_mode"],
        json!("wal")
    );
    assert_eq!(
        select(&writer, "SELECT COUNT(*) AS n FROM parent", &[])
            .await
            .unwrap()[0]["n"],
        json!(2)
    );
}

#[tokio::test]
async fn backup_copies_uncheckpointed_rows_and_leaves_no_pending_file() {
    let (dir, pool) = temp_db().await;
    setup(&pool).await;
    transaction(
        &pool,
        &[step(
            "INSERT INTO parent (id, title) VALUES ($1, $2)",
            json!([1, "旧稿"]),
        )],
    )
    .await
    .unwrap();
    let copy = backup(&pool, dir.path(), "20261030-120000-000-v1-to-v2")
        .await
        .unwrap();
    assert_eq!(
        copy.file_name().unwrap(),
        "storyforge-engine.backup-20261030-120000-000-v1-to-v2.sqlite3"
    );
    let names: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.iter().all(|name| !name.ends_with(".pending")),
        "{names:?}"
    );
    let copied = open(&copy).await.unwrap();
    let rows = select(&copied, "SELECT id, title FROM parent", &[])
        .await
        .unwrap();
    assert_eq!(
        Value::Array(rows.into_iter().map(Value::Object).collect()),
        json!([{ "id": 1, "title": "旧稿" }])
    );
}

#[test]
fn prune_keeps_the_newest_backups_and_drops_pending_copies() {
    let dir = tempfile::tempdir().unwrap();
    let backups = [
        "storyforge-engine.backup-20261001-000000-000-v1-to-v2.sqlite3",
        "storyforge-engine.backup-20261002-000000-000-v2-to-v3.sqlite3",
        "storyforge-engine.backup-20261003-000000-000-v3-to-v4.sqlite3",
        "storyforge-engine.backup-20261004-000000-000-v4-to-v5.sqlite3",
        "storyforge-engine.backup-20261005-000000-000-v5-to-v6.sqlite3",
    ];
    let others = [
        "storyforge-engine.backup-20261006-000000-000-v6-to-v7.sqlite3.pending",
        ENGINE_DB_FILE,
        "storyforge-engine.sqlite3-wal",
        PYTHON_DB_FILE,
    ];
    for name in backups.iter().chain(others.iter()) {
        std::fs::write(dir.path().join(name), b"x").unwrap();
    }
    prune_backups(dir.path(), 3).unwrap();
    let mut left: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    left.sort();
    let mut expected: Vec<String> = backups[2..]
        .iter()
        .chain(others[1..].iter())
        .map(|name| name.to_string())
        .collect();
    expected.sort();
    assert_eq!(left, expected);
}
