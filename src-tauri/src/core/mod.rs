//! The work of Dispatch without a window: the terminals, the side panel, the chats, the tasks,
//! the rules and the status bar. Nothing here knows the window or the program around it. The
//! program builds one `Core` with the folders of this computer, the version of the app and an
//! event sink, and hands each call of the page to the function of the same name. Today the app
//! (`lib.rs`, `commands.rs`) is that program; the headless host of docs/remote-client.md
//! (task 3, `remote-host`) is the second one.

pub mod chats;
pub mod context;
pub mod flow;
pub mod hostrun;
pub mod info;
pub mod pipeline;
pub mod power;
pub mod pty;
pub mod rules;
pub mod rules_check;
pub mod status;
pub mod store;
pub mod tickets;
pub mod update;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;

/// The event with new text of a terminal. Its payload is `{ id, data }`.
pub const PTY_OUTPUT: &str = "pty-output";
/// The event of a terminal whose shell ended. Its payload is the id of the terminal.
pub const PTY_EXIT: &str = "pty-exit";

/// Where the core sends its events: to the window in the app, to the connected windows in the
/// host. An event is its name and a JSON payload.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The state of the work: the terminals, the three caches, the folders and the version.
pub struct Core {
    pub(crate) sessions: Arc<pty::Sessions>,
    pub(crate) transcripts: info::Transcripts,
    pub(crate) git_cache: info::GitCache,
    pub(crate) chat_cache: chats::ChatCache,
    /// The data folder of the program, or why it is not known.
    data_dir: Result<PathBuf, String>,
    /// The home folder of the user, or why it is not known.
    home_dir: Result<PathBuf, String>,
    version: String,
    pub(crate) sink: Arc<dyn EventSink>,
}

impl Core {
    /// A core with the data folder, the home folder, the version of the app and the event sink.
    /// It makes the folder of the screen texts and names the folder of the pasted images.
    pub fn new(
        data_dir: Result<PathBuf, String>,
        home_dir: Result<PathBuf, String>,
        version: String,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        // The same folder as `image_save` uses. Setup pipeline lets triage read it.
        if let Ok(dir) = &data_dir {
            let _ = pipeline::PASTED_DIR.set(dir.join("pasted"));
        }
        let core = Core {
            sessions: Arc::default(),
            transcripts: info::Transcripts::default(),
            git_cache: info::GitCache::default(),
            chat_cache: chats::ChatCache::default(),
            data_dir,
            home_dir,
            version,
            sink,
        };
        let _ = core.data_dir();
        core
    }

    /// The data folder, with its folder `screens`.
    pub(crate) fn data_dir(&self) -> Result<PathBuf, String> {
        let dir = self.app_data_dir()?;
        fs::create_dir_all(dir.join("screens")).map_err(err)?;
        Ok(dir)
    }

    /// The data folder as it is.
    pub(crate) fn app_data_dir(&self) -> Result<PathBuf, String> {
        self.data_dir.clone()
    }

    /// The home folder of the user.
    pub(crate) fn home_dir(&self) -> Result<PathBuf, String> {
        self.home_dir.clone()
    }

    /// The version of the app.
    pub(crate) fn version(&self) -> String {
        self.version.clone()
    }
}
