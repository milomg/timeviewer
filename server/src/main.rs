use anyhow::Result;
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    handler::HandlerWithoutStateExt,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Extension, Router,
};
use chrono::prelude::*;
use futures::stream::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use std::net::SocketAddr;
use tokio::sync::broadcast::{self, Sender};
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Serialize, Deserialize, Debug)]
struct TimeEvent {
    starttime: String,
    endtime: Option<String>,
    title: Option<String>,
    url: Option<String>,
    app: String,
}

#[derive(Serialize, Deserialize)]
struct NetworkMessageThing {
    app: String,
    title: String,
    url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "timeviewer=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let addr = SocketAddr::from(([127, 0, 0, 1], 5168));

    let pool = SqlitePoolOptions::new().connect("sqlite:tmp.db").await?;
    sqlx::migrate!().run(&pool).await?;

    let (tx, _) = broadcast::channel::<String>(16);
    // Create the event loop and TCP listener we'll accept connections on.

    async fn handle_404() -> (StatusCode, &'static str) {
        (StatusCode::NOT_FOUND, "Not found")
    }

    let serve_dir = ServeDir::new("public")
        .append_index_html_on_directories(true)
        .not_found_service(handle_404.into_service());
    let app = Router::new()
        .route("/client", get(client_ws_handler))
        .route("/server", get(server_ws_handler))
        .fallback_service(serve_dir)
        .layer(Extension((tx, pool)))
        .layer(TraceLayer::new_for_http());

    println!("Listening on: {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    axum::serve(listener, app).await?;

    Ok(())
}

async fn client_ws_handler(
    ws: WebSocketUpgrade,
    Extension((tx, pool)): Extension<(Sender<String>, Pool<Sqlite>)>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        accept_client_connection(socket, pool.clone(), tx.clone())
            .await
            .unwrap()
    })
}

async fn server_ws_handler(
    ws: WebSocketUpgrade,
    Extension((tx, pool)): Extension<(Sender<String>, Pool<Sqlite>)>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| async move {
        accept_server_connection(socket, pool.clone(), tx.clone())
            .await
            .unwrap()
    })
}

async fn accept_client_connection(
    mut stream: WebSocket,
    pool: Pool<Sqlite>,
    tx: Sender<String>,
) -> Result<()> {
    let mut rx = tx.subscribe();

    let asdf = Local::now()
        .with_hour(8)
        .unwrap()
        .with_minute(0)
        .unwrap()
        .with_second(0)
        .unwrap()
        .with_nanosecond(0)
        .unwrap();
    let hour = asdf.to_rfc3339();

    let last_hour = sqlx::query_as!(
            TimeEvent,
            "SELECT * FROM times WHERE datetime(endtime) > datetime(?) or endtime IS NULL ORDER BY starttime",
            hour
        )
        .fetch_all(&pool)
        .await?;

    let stringified = serde_json::to_string(&last_hour).expect("stringifying failed");
    stream.send(Message::Text(stringified)).await?;

    while let Ok(data) = rx.recv().await {
        stream.send(Message::Text(data)).await?;
    }

    Ok(())
}

async fn accept_server_connection(
    mut stream: WebSocket,
    pool: Pool<Sqlite>,
    tx: Sender<String>,
) -> Result<()> {
    let mut last_time: Option<String> = None;
    while let Some(msg) = stream.next().await {
        if let Ok(Message::Text(str)) = msg {
            if let Some(time) = &last_time {
                let new_time = Utc::now().to_rfc3339();
                sqlx::query!(
                    "UPDATE times SET endtime = ? WHERE starttime = ?",
                    new_time,
                    time
                )
                .execute(&pool)
                .await?;
            }

            let starttime = Utc::now().to_rfc3339();
            let NetworkMessageThing { app, title, url } = serde_json::from_str(&str).unwrap();

            let _ = tx.send(
                json!({
                    "app": app,
                    "title": title,
                    "url": url,
                    "starttime": starttime
                })
                .to_string(),
            );

            if app.is_empty() {
                last_time = None
            } else {
                sqlx::query!(
                    "INSERT INTO times (app, title, url, starttime) VALUES (?, ?, ?, ?)",
                    app,
                    title,
                    url,
                    starttime
                )
                .execute(&pool)
                .await?;

                last_time = Some(starttime);
            }
        }
    }

    if let Some(time) = &last_time {
        let new_time = Utc::now().to_rfc3339();
        sqlx::query!(
            "UPDATE times SET endtime = ? WHERE starttime = ?",
            new_time,
            time
        )
        .execute(&pool)
        .await?;
    }

    Ok(())
}
