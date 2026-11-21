//! The PIN of the phone page (ticket a-pin-unlocks-the-phone-page). The user sets it on the computer
//! in Options, tab Phone; the host asks the phone for it before any phone call works (`host/unlock.rs`).
//! The data folder keeps `phone-pin.json`: a salted, slow hash of the PIN (Argon2id, the PHC string
//! holds the salt and the parameters) and the count of wrong PINs since the last right one. The PIN
//! itself is never written. After `MAX_WRONG` wrong PINs the phone is locked until the user clicks
//! Unlock the phone in Options or sets a new PIN. The app and the host share this file: the host reads
//! it at each phone call, so a new PIN, a removed file or a lock counts without a restart.

use std::fs;
use std::path::Path;

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};

use crate::core::err;

/// The file of the PIN in the data folder.
pub const PIN_FILE: &str = "phone-pin.json";
/// A PIN has at least this many digits.
pub const MIN_DIGITS: usize = 6;
/// This many wrong PINs lock the phone.
pub const MAX_WRONG: u32 = 5;
/// The text of a refused PIN.
pub const BAD_PIN: &str = "the PIN must have at least 6 digits and nothing else";

/// The content of `phone-pin.json`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PinFile {
    /// The PHC string of the Argon2id hash: algorithm, parameters, salt and hash.
    pub hash: String,
    /// The wrong PINs since the last right one or the last unlock.
    #[serde(default)]
    pub wrong: u32,
}

/// The answer to a PIN.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// No PIN is set: the user must set one on the computer first.
    NoPin,
    /// The phone is locked after `MAX_WRONG` wrong PINs.
    Locked,
    /// The PIN is wrong; `left` tries remain before the lock.
    Wrong { left: u32 },
    Ok,
}

/// Whether `pin` is a valid PIN: `MIN_DIGITS` or more ASCII digits, nothing else.
pub fn pin_ok(pin: &str) -> bool {
    pin.len() >= MIN_DIGITS && pin.bytes().all(|byte| byte.is_ascii_digit())
}

fn write(dir: &Path, file: &PinFile) -> Result<(), String> {
    let path = dir.join(PIN_FILE);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_string(file).map_err(err)?).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

/// The PIN file of the data folder; `None` without a file or with a file that does not parse.
pub fn read(dir: &Path) -> Option<PinFile> {
    let file: PinFile = serde_json::from_str(&fs::read_to_string(dir.join(PIN_FILE)).ok()?).ok()?;
    (!file.hash.is_empty()).then_some(file)
}

/// Whether the file says that the phone is locked.
pub fn locked(file: &PinFile) -> bool {
    file.wrong >= MAX_WRONG
}

/// Sets the PIN: a new salt and hash, and the wrong count at zero. Refuses a PIN that `pin_ok` refuses.
pub fn set(dir: &Path, pin: &str) -> Result<(), String> {
    if !pin_ok(pin) {
        return Err(BAD_PIN.into());
    }
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("no random bytes for the salt: {e}"))?;
    let salt = SaltString::encode_b64(&bytes).map_err(err)?;
    let hash = Argon2::default().hash_password(pin.as_bytes(), &salt).map_err(err)?.to_string();
    write(dir, &PinFile { hash, wrong: 0 })
}

fn matches(file: &PinFile, pin: &str) -> bool {
    PasswordHash::new(&file.hash).is_ok_and(|parsed| Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok())
}

/// Checks `pin` against the file. A wrong PIN counts; the one that reaches `MAX_WRONG` gives `Locked`.
/// A right PIN sets the count to zero.
pub fn verify(dir: &Path, pin: &str) -> Verdict {
    let Some(mut file) = read(dir) else { return Verdict::NoPin };
    if locked(&file) {
        return Verdict::Locked;
    }
    if matches(&file, pin) {
        if file.wrong != 0 {
            file.wrong = 0;
            let _ = write(dir, &file);
        }
        return Verdict::Ok;
    }
    file.wrong += 1;
    let _ = write(dir, &file);
    if locked(&file) { Verdict::Locked } else { Verdict::Wrong { left: MAX_WRONG - file.wrong } }
}

/// Ends the lock: the wrong count goes to zero, the PIN stays.
pub fn unlock(dir: &Path) -> Result<(), String> {
    match read(dir) {
        Some(file) => write(dir, &PinFile { wrong: 0, ..file }),
        None => Ok(()),
    }
}

/// Whether a PIN is set, and whether the phone is locked.
pub fn status(dir: &Path) -> (bool, bool) {
    match read(dir) {
        Some(file) => (true, locked(&file)),
        None => (false, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dispatch-phonepin-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn phonepin_a_pin_of_6_digits_is_set_and_verified() {
        let dir = scratch("set");
        assert_eq!(status(&dir), (false, false));
        assert_eq!(verify(&dir, "123456"), Verdict::NoPin);
        set(&dir, "123456").unwrap();
        assert_eq!(status(&dir), (true, false));
        assert_eq!(verify(&dir, "123456"), Verdict::Ok);
        assert_eq!(verify(&dir, "123456"), Verdict::Ok, "again");
        assert!(!dir.join("phone-pin.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_a_wrong_pin_fails_and_counts() {
        let dir = scratch("wrong");
        set(&dir, "123456").unwrap();
        assert_eq!(verify(&dir, "123457"), Verdict::Wrong { left: 4 });
        assert_eq!(verify(&dir, "1234567"), Verdict::Wrong { left: 3 }, "one digit more is another PIN");
        assert_eq!(verify(&dir, ""), Verdict::Wrong { left: 2 });
        assert_eq!(read(&dir).unwrap().wrong, 3);
        assert_eq!(verify(&dir, "123456"), Verdict::Ok);
        assert_eq!(read(&dir).unwrap().wrong, 0, "a right PIN ends the count");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_fewer_than_6_digits_or_a_letter_is_refused() {
        let dir = scratch("rule");
        for bad in ["12345", "", "12345a", "a23456", "12 3456", "１２３４５６"] {
            assert!(!pin_ok(bad), "{bad}");
            assert_eq!(set(&dir, bad), Err(BAD_PIN.into()), "{bad}");
        }
        assert!(read(&dir).is_none(), "a refused PIN writes nothing");
        for good in ["123456", "000000", "123456789012"] {
            assert!(pin_ok(good), "{good}");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_the_file_holds_no_pin_text() {
        let dir = scratch("text");
        set(&dir, "908172").unwrap();
        let text = fs::read_to_string(dir.join(PIN_FILE)).unwrap();
        assert!(!text.contains("908172"), "{text}");
        assert!(text.contains("$argon2id$"), "{text}");
        assert!(text.contains("\"wrong\":0"), "{text}");
        let first = read(&dir).unwrap().hash;
        set(&dir, "908172").unwrap();
        assert_ne!(read(&dir).unwrap().hash, first, "a new salt each time");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_5_wrong_pins_lock_and_the_right_pin_still_fails() {
        let dir = scratch("lock");
        set(&dir, "123456").unwrap();
        for left in [4, 3, 2, 1] {
            assert_eq!(verify(&dir, "000000"), Verdict::Wrong { left });
            assert_eq!(status(&dir), (true, false));
        }
        assert_eq!(verify(&dir, "000000"), Verdict::Locked, "the 5th wrong PIN locks");
        assert_eq!(status(&dir), (true, true));
        assert!(locked(&read(&dir).unwrap()));
        assert_eq!(verify(&dir, "123456"), Verdict::Locked, "the right PIN fails while locked");
        assert_eq!(verify(&dir, "000000"), Verdict::Locked);
        assert_eq!(read(&dir).unwrap().wrong, MAX_WRONG, "the count does not grow past the lock");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_unlock_resets_the_count_and_keeps_the_pin() {
        let dir = scratch("unlock");
        unlock(&dir).unwrap();
        assert!(read(&dir).is_none(), "nothing to unlock without a PIN");
        set(&dir, "123456").unwrap();
        let hash = read(&dir).unwrap().hash;
        for _ in 0..5 {
            verify(&dir, "000000");
        }
        assert_eq!(status(&dir), (true, true));
        unlock(&dir).unwrap();
        assert_eq!(status(&dir), (true, false));
        assert_eq!(read(&dir).unwrap().hash, hash, "the PIN stays");
        assert_eq!(verify(&dir, "123456"), Verdict::Ok);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn phonepin_a_new_pin_ends_the_old_one_and_the_lock() {
        let dir = scratch("new");
        set(&dir, "123456").unwrap();
        for _ in 0..5 {
            verify(&dir, "000000");
        }
        assert_eq!(status(&dir), (true, true));
        set(&dir, "654321").unwrap();
        assert_eq!(status(&dir), (true, false), "a new PIN ends the lock");
        assert_eq!(verify(&dir, "123456"), Verdict::Wrong { left: 4 }, "the old PIN is wrong now");
        assert_eq!(verify(&dir, "654321"), Verdict::Ok);
        fs::write(dir.join(PIN_FILE), "not json").unwrap();
        assert_eq!(read(&dir), None, "a broken file counts as no PIN");
        assert_eq!(verify(&dir, "654321"), Verdict::NoPin);
        fs::remove_dir_all(&dir).unwrap();
    }
}
