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
