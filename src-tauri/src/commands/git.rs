use crate::models::{
    Ack, GitAvailabilityResponse, GitBranchInfo, GitCheckoutInput, GitCommitInfo, GitCommitInput,
    GitDiffHunk, GitDiffInput, GitDiffLine, GitDiffResponse, GitDownloadStartResponse,
    GitDownloadStatusResponse, GitLogInput, GitPathsInput, GitRefInput, GitRemoteInput,
    GitStatusEntry, GitStatusResponse, GitTaskInput,
};
use crate::state::{AppState, GitDownloadTask};
use crate::storage;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;
use uuid::Uuid;

const GIT_RELEASE_API: &str = "https://api.github.com/repos/git-for-windows/git/releases/latest";
const DOWNLOAD_USER_AGENT: &str = "LatoTex/0.1.0 (+https://github.com/git-for-windows/git)";

include!("git/chunk1.rs");
include!("git/chunk2.rs");
include!("git/chunk3.rs");
