use chrono::prelude::*;
use chrono::Duration;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use std::{env, io::Error};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast::{self, Sender},
};
use tokio_tungstenite::tungstenite::Message;

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
async fn main() -> Result<(), Error> {
    let addr = env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:8080".to_string());

    let pool = SqlitePoolOptions::new()
        .connect("sqlite:tmp.db")
        .await
        .expect("failed to open db");
    sqlx::migrate!()
        .run(&pool)
        .await
        .expect("failed to run migrations");

    let (tx, _) = broadcast::channel::<String>(16);
    // Create the event loop and TCP listener we'll accept connections on.
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
    println!("Listening on: {}", addr);

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(accept_connection(stream, pool.clone(), tx.clone()));
    }

    Ok(())
}

async fn accept_connection(stream: TcpStream, pool: Pool<Sqlite>, tx: Sender<String>) {
    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .expect("Error during the websocket handshake occurred");

    let (mut write, mut read) = ws_stream.split();

    let first_message = read.next().await.unwrap().unwrap().into_text().unwrap();
    if let "HI" = first_message.as_str() {
        let mut last_time: Option<String> = None;
        while let Some(msg) = read.next().await {
            if let Ok(Message::Text(str)) = msg {
                if let Some(time) = &last_time {
                    let new_time = Utc::now().to_rfc3339();
                    sqlx::query!(
                        "UPDATE times SET endtime = ? WHERE starttime = ?",
                        new_time,
                        time
                    )
                    .execute(&pool)
                    .await
                    .expect("updating failed");
                }

                let starttime = Utc::now().to_rfc3339();
                let NetworkMessageThing {
                    app,
                    title,
                    url
                } = serde_json::from_str(&str).unwrap();

                let _ = tx.send(
                    json!({
                        "app": app,
                        "title": title,
                        "url": url,
                        "starttime": starttime
                    })
                    .to_string(),
                );

                if app == "" {
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
                    .await
                    .expect("inserting failed");

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
            .await
            .expect("updating failed");
        }
    } else {
        let mut rx = tx.subscribe();

        let asdf = Local::now().with_hour(8).unwrap().with_minute(0).unwrap().with_second(0).unwrap().with_nanosecond(0).unwrap();
        let hour = asdf.to_rfc3339();
        dbg!(&hour);
        let last_hour = sqlx::query_as!(
            TimeEvent,
            "SELECT * FROM times WHERE datetime(endtime) > datetime(?) or endtime IS NULL ORDER BY starttime",
            hour
        )
        .fetch_all(&pool)
        .await
        .expect("querying failed");

        let stringified = serde_json::to_string(&last_hour).expect("stringifying failed");
        write
            .send(Message::text(stringified))
            .await
            .expect("sending initial message failed");

        while let Ok(data) = rx.recv().await {
            write
                .send(Message::text(data))
                .await
                .expect("sending a message didn't work");
        }
    }
}
