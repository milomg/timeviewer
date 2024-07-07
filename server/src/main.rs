use anyhow::{anyhow, Result};
use axum::{
    extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade},
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
use std::{
    borrow::Cow,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::broadcast::{self, Sender},
    time, try_join,
};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
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

#[derive(Clone)]
struct State {
    tx: Sender<String>,
    pool: Pool<Sqlite>,
    last_time: Arc<Mutex<Option<String>>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG")
                .as_deref()
                .unwrap_or("timeviewer=debug,tower_http=debug"),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let addr = SocketAddr::from(([127, 0, 0, 1], 5168));

    let pool = SqlitePoolOptions::new()
        .connect(
            std::env::var("DATABASE_URL")
                .as_deref()
                .unwrap_or("sqlite:tmp.db"),
        )
        .await?;
    sqlx::migrate!().run(&pool).await?;

    let (tx, _) = broadcast::channel::<String>(16);

    async fn handle_404() -> (StatusCode, &'static str) {
        (StatusCode::NOT_FOUND, "Not found")
    }

    let last_time_r: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let serve_dir = ServeDir::new("public")
        .append_index_html_on_directories(true)
        .not_found_service(handle_404.into_service());
    let app = Router::new()
        .route("/client", get(client_ws_handler))
        .route("/server", get(server_ws_handler))
        .route_service("/graph", ServeFile::new("public/index.html"))
        .fallback_service(serve_dir)
        .layer(Extension(State {
            tx,
            pool,
            last_time: last_time_r,
        }))
        .layer(TraceLayer::new_for_http());

    println!("Listening on: {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    axum::serve(listener, app).await?;

    Ok(())
}

async fn client_ws_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<State>,
) -> impl IntoResponse {
    ws.on_upgrade(move |mut socket| async move {
        if let Err(err) = accept_client_connection(&mut socket, state.clone()).await {
            tracing::error!("Error handling client connection: {:?}", err);
            if let Err(e) = socket
                .send(Message::Close(Some(CloseFrame {
                    code: close_code::ERROR,
                    reason: Cow::Borrowed("Internal server error"),
                })))
                .await
            {
                tracing::error!("Error sending close frame: {:?}", e);
                // can ignore this
            }
        }
    })
}

async fn server_ws_handler(
    ws: WebSocketUpgrade,
    Extension(state): Extension<State>,
) -> impl IntoResponse {
    ws.on_upgrade(move |mut socket| async move {
        if let Err(err) = accept_server_connection(&mut socket, state.clone()).await {
            tracing::error!("Error handling server connection: {:?}", err);
            if let Err(e) = socket
                .send(Message::Close(Some(CloseFrame {
                    code: close_code::ERROR,
                    reason: Cow::Borrowed("Internal server error"),
                })))
                .await
            {
                tracing::error!("Error sending close frame: {:?}", e);
                // can ignore this
            }
        }
    })
}

async fn accept_client_connection(
    stream: &mut WebSocket,
    State {
        pool,
        tx,
        last_time,
    }: State,
) -> Result<()> {
    let mut rx = tx.subscribe();

    let hour = Some(Local::now())
        .map(|x| x - chrono::Duration::hours(8))
        .and_then(|x| x.with_hour(8))
        .and_then(|x| x.with_minute(0))
        .and_then(|x| x.with_second(0))
        .and_then(|x| x.with_nanosecond(0))
        .ok_or_else(|| anyhow!("Failed to create time at 8:00am"))?
        .to_rfc3339();

    let mut last_hour = sqlx::query_as!(
            TimeEvent,
            "SELECT * FROM times WHERE datetime(endtime) > datetime(?) or endtime IS NULL ORDER BY starttime",
            hour
        )
        .fetch_all(&pool)
        .await?;

    let last_time = last_time.lock().map_err(|_| anyhow!("Poisoned"))?.clone();
    if let (Some(time), Some(last)) = (last_time.clone(), last_hour.last_mut()) {
        if last.starttime == time {
            last.endtime = None;
        }
    }

    let stringified = serde_json::to_string(&last_hour)?;
    stream.send(Message::Text(stringified)).await?;

    while let Ok(data) = rx.recv().await {
        stream.send(Message::Text(data)).await?;
    }

    Ok(())
}

async fn message_loop(
    stream: &mut WebSocket,
    State {
        pool,
        tx,
        last_time,
    }: State,
) -> Result<()> {
    while let Some(msg) = stream.next().await {
        if let Ok(Message::Text(str)) = msg {
            let update_time = {
                let mut lock = last_time.lock().map_err(|_| anyhow!("Poisoned"))?;
                (*lock).take()
            };
            let new_time = Utc::now().to_rfc3339();
            let starttime = new_time.clone();
            if let Some(time) = update_time {
                sqlx::query!(
                    "UPDATE times SET endtime = ? WHERE starttime = ?",
                    new_time,
                    time
                )
                .execute(&pool)
                .await?;
            }

            let NetworkMessageThing { app, title, url } = serde_json::from_str(&str)?;

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
                {
                    let mut o = last_time.lock().map_err(|_| anyhow!("Poisoned"))?;
                    *o = None;
                }
            } else {
                {
                    let mut o = last_time.lock().map_err(|_| anyhow!("Poisoned"))?;
                    *o = Some(starttime.clone());
                }
                sqlx::query!(
                    "INSERT INTO times (app, title, url, starttime, endtime) VALUES (?, ?, ?, ?, ?)",
                    app,
                    title,
                    url,
                    starttime,
                    starttime
                )
                .execute(&pool)
                .await?;
            }
        }
    }

    let update_time = {
        let mut lock = last_time.lock().map_err(|_| anyhow!("Poisoned"))?;
        (*lock).take()
    };
    if let Some(time) = &update_time {
        let new_time = Utc::now().to_rfc3339();
        sqlx::query!(
            "UPDATE times SET endtime = ? WHERE starttime = ?",
            new_time,
            time
        )
        .execute(&pool)
        .await?;

        // create an empty event so that the client stops the timer
        let _ = tx.send(
            json!({
                "app": "",
                "title": "",
                "url": "",
                "starttime": new_time
            })
            .to_string(),
        );
    }
    Ok(())
}

async fn time_updater(
    State {
        pool,
        tx: _,
        last_time,
    }: State,
) -> Result<()> {
    let mut interval = time::interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        let last_time = last_time.lock().map_err(|_| anyhow!("Poisoned"))?.clone();

        if let Some(time) = last_time {
            let new_time = Utc::now().to_rfc3339();
            sqlx::query!(
                "UPDATE times SET endtime = ? WHERE starttime = ?",
                new_time,
                time
            )
            .execute(&pool)
            .await?;
        }
    }
}

async fn accept_server_connection(stream: &mut WebSocket, state: State) -> Result<()> {
    let time_updater = tokio::spawn(time_updater(state.clone()));

    let message_loop = message_loop(stream, state.clone());

    if let Err(e) = try_join!(async { time_updater.await? }, message_loop) {
        tracing::error!("Error in server connection: {:?}", e);
    }

    Ok(())
}
