use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use crate::storage;

const BROKER_LINE_LIMIT: usize = 144 * 1024;
const BROKER_MAX_CONNECTIONS: usize = 8;

#[derive(Debug)]
struct BrokerHandle {
    address: String,
    db_path: PathBuf,
    runtime_root: PathBuf,
    app_data_dir: PathBuf,
    session_log_path: PathBuf,
}

static BROKER: OnceLock<Mutex<Option<BrokerHandle>>> = OnceLock::new();

struct ConnectionLease(Arc<AtomicUsize>);

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn validate_loopback_address(value: &str) -> Result<SocketAddr, String> {
    let address = value
        .parse::<SocketAddr>()
        .map_err(|_| "agent.mcp.broker_invalid".to_string())?;
    if !address.ip().is_loopback() {
        return Err("agent.mcp.broker_not_loopback".to_string());
    }
    Ok(address)
}

fn handle_connection(
    mut stream: TcpStream,
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    session_log_path: &Path,
) {
    let peer_is_loopback = stream
        .peer_addr()
        .map(|address| address.ip().is_loopback())
        .unwrap_or(false);
    if !peer_is_loopback {
        return;
    }
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));
    let Ok(reader_stream) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reader_stream);
    loop {
        let mut line = String::new();
        let Ok(read) = reader.read_line(&mut line) else {
            break;
        };
        if read == 0 {
            break;
        }
        let response = if line.len() > BROKER_LINE_LIMIT {
            json!({"response": super::agent_mcp_proxy::failure(
                Value::Null,
                -32600,
                "agent.mcp.request_too_large",
            )})
        } else {
            match serde_json::from_str::<Value>(&line) {
                Ok(envelope) => {
                    let token = envelope.get("token").and_then(Value::as_str).unwrap_or("");
                    let message = envelope.get("message").cloned().unwrap_or(Value::Null);
                    let id = message.get("id").cloned().unwrap_or(Value::Null);
                    let forwarded = match storage::validate_agent_mcp_session(db_path, token) {
                        Ok(session) => super::agent_mcp_proxy::handle_message(
                            db_path,
                            runtime_root,
                            app_data_dir,
                            session_log_path,
                            &session,
                            message,
                        ),
                        Err(error) => Some(super::agent_mcp_proxy::failure(id, -32002, &error)),
                    };
                    json!({"response": forwarded})
                }
                Err(_) => json!({"response": super::agent_mcp_proxy::failure(
                    Value::Null,
                    -32700,
                    "agent.mcp.invalid_json",
                )}),
            }
        };
        if writeln!(stream, "{response}").is_err() || stream.flush().is_err() {
            break;
        }
    }
}

fn spawn_broker(
    db_path: PathBuf,
    runtime_root: PathBuf,
    app_data_dir: PathBuf,
    session_log_path: PathBuf,
) -> Result<BrokerHandle, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| "agent.mcp.broker_bind_failed".to_string())?;
    let address = listener
        .local_addr()
        .map_err(|_| "agent.mcp.broker_bind_failed".to_string())?;
    validate_loopback_address(&address.to_string())?;
    let worker_db_path = db_path.clone();
    let worker_runtime_root = runtime_root.clone();
    let worker_app_data_dir = app_data_dir.clone();
    let worker_session_log_path = session_log_path.clone();
    thread::Builder::new()
        .name("latotex-mcp-broker".to_string())
        .spawn(move || {
            let active = Arc::new(AtomicUsize::new(0));
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    break;
                };
                if active.fetch_add(1, Ordering::AcqRel) >= BROKER_MAX_CONNECTIONS {
                    active.fetch_sub(1, Ordering::AcqRel);
                    continue;
                }
                let connection_counter = active.clone();
                let connection_db_path = worker_db_path.clone();
                let connection_runtime_root = worker_runtime_root.clone();
                let connection_app_data_dir = worker_app_data_dir.clone();
                let connection_session_log_path = worker_session_log_path.clone();
                let _ = thread::Builder::new()
                    .name("latotex-mcp-connection".to_string())
                    .spawn(move || {
                        let _lease = ConnectionLease(connection_counter);
                        handle_connection(
                            stream,
                            &connection_db_path,
                            &connection_runtime_root,
                            &connection_app_data_dir,
                            &connection_session_log_path,
                        );
                    });
            }
        })
        .map_err(|_| "agent.mcp.broker_start_failed".to_string())?;
    Ok(BrokerHandle {
        address: address.to_string(),
        db_path,
        runtime_root,
        app_data_dir,
        session_log_path,
    })
}

pub(crate) fn ensure_running(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    session_log_path: &Path,
) -> Result<String, String> {
    let slot = BROKER.get_or_init(|| Mutex::new(None));
    let mut guard = slot
        .lock()
        .map_err(|_| "agent.mcp.broker_unavailable".to_string())?;
    if let Some(handle) = guard.as_ref() {
        if handle.db_path != db_path
            || handle.runtime_root != runtime_root
            || handle.app_data_dir != app_data_dir
            || handle.session_log_path != session_log_path
        {
            return Err("agent.mcp.broker_scope_mismatch".to_string());
        }
        return Ok(handle.address.clone());
    }
    let handle = spawn_broker(
        db_path.to_path_buf(),
        runtime_root.to_path_buf(),
        app_data_dir.to_path_buf(),
        session_log_path.to_path_buf(),
    )?;
    let address = handle.address.clone();
    *guard = Some(handle);
    Ok(address)
}

pub(crate) fn connect(address: &str) -> Result<TcpStream, String> {
    let address = validate_loopback_address(address)?;
    TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|_| "agent.mcp.broker_unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broker_address_must_be_loopback() {
        assert!(validate_loopback_address("127.0.0.1:4321").is_ok());
        assert!(validate_loopback_address("[::1]:4321").is_ok());
        assert_eq!(
            validate_loopback_address("192.0.2.10:4321").unwrap_err(),
            "agent.mcp.broker_not_loopback"
        );
    }
}
