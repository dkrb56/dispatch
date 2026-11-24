//! The voice alert: the natural voices of the Edge "Read aloud" service.
//!
//! The service is not an official interface of Microsoft and can stop one day; the page then
//! falls back to the voice of the system and to the chime. The protocol and the token follow the
//! open project edge-tts (rany2/edge-tts, `communicate.py`, `constants.py`, `drm.py`, version 2
//! of the `Sec-MS-GEC` token of 2026-10-13). Each phrase that the service made stays in
//! `<data folder>/voice-cache` and plays again with no network.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::core::{err, Core};

/// The WebSocket address of the service, without its query.
const SERVICE: &str = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/// The fixed client token of the Edge browser.
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/// The browser version that the token claims (`constants.py`).
const CHROMIUM_FULL_VERSION: &str = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION: &str = "143";
/// The origin of the "Read aloud" extension of Edge.
const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
/// The time from 1601-01-01 (Windows) to 1970-01-01 (Unix), in seconds.
const WIN_EPOCH: u64 = 11_644_473_600;
/// The longest wait for one phrase: the connection, the request and all the audio. The service
/// sometimes pauses 2 to 6 seconds before the first audio and again in the middle; a line then
/// takes up to 11 seconds (measured 2026-11-24). The page lets one line hold the queue for at most
/// 60 seconds (`VOICE_LINE_CAP_MS`), playback included.
const TIMEOUT: Duration = Duration::from_secs(30);
/// The longest text that the page may ask for.
const MAX_TEXT: usize = 500;
/// The cache keeps at most this many phrases; the oldest go first.
const MAX_FILES: usize = 300;
/// The folder of the cache in the data folder.
const CACHE_FOLDER: &str = "voice-cache";

// ---------------------------------------------------------------------------------------------
// The token `Sec-MS-GEC`, version 2: `<CS64 of 16 hex>-<salted SHA-256 of 64 hex>`, upper case.
// A port of `drm.py`, line by line where the reference is not the standard SHA-256.
// ---------------------------------------------------------------------------------------------

/// The standard initial hash values (FIPS 180-4).
const SHA256_INITIAL: [u32; 8] = [
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
];
/// The working registers of the salted first block after its round 13.
const SHA256_STATE: [u32; 8] = [
    0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2,
];
/// The fixed parts of the words 16 to 29 of the salted first block.
const SHA256_SCHEDULE: [u32; 14] = [
    0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
    0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564,
];
/// The standard round constants.
const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];
const SHA256_ADJUSTMENT: u32 = 0xC9DC06A7;
const SHA256_SIGMA0_ADJUSTMENT: u32 = 0x059C0B80;
const SHA256_SIGMA1_ADJUSTMENT: u32 = 0x000B92C0;

/// The round constants of the salted first block: the constant 14 is the adjustment.
const fn block_constants() -> [u32; 64] {
    let mut k = SHA256_ROUND_CONSTANTS;
    k[14] = SHA256_ADJUSTMENT;
    k
}
const SHA256_BLOCK_CONSTANTS: [u32; 64] = block_constants();

const CS64_COEFFICIENTS: [(u32, u32); 14] = [
    (0xE82E91B1, 0xB32700D0),
    (0x44DE24C6, 0x88DFF51D),
    (0x3BEB65BC, 0x29514038),
    (0xC89C5933, 0xB328CBDF),
    (0x8D1EC211, 0xD405B4D5),
    (0x314EF5D5, 0x26E55F3C),
    (0xE92491B1, 0x607801C6),
    (0xF0A5B9D5, 0x82B2C1FB),
    (0x06064CF3, 0xFA51A3DA),
    (0xDA79FA60, 0x207CC464),
    (0xBED20560, 0x3C3C74F3),
    (0x89F9C9F8, 0xD2D14B61),
    (0x35FA38C6, 0xBB04A2C1),
    (0xCB49E3C6, 0xC5626167),
];
const CS64_FACTOR: u32 = 0x82893933;
const CS64_ADJUSTMENT0: u32 = 0xF2F90B1A;
const CS64_ADJUSTMENT1: u32 = 0x0B1A0000;

fn rol16(value: u32) -> u32 {
    value.rotate_left(16)
}

fn sigma0(value: u32) -> u32 {
    value.rotate_right(7) ^ value.rotate_right(18) ^ (value >> 3)
}

fn sigma1(value: u32) -> u32 {
    value.rotate_right(17) ^ value.rotate_right(19) ^ (value >> 10)
}

/// The data as little-endian 32-bit words, zero-padded to whole words and to an even count.
fn words_le4_even(data: &[u8]) -> Vec<u32> {
    let mut padded = data.to_vec();
    padded.resize(data.len().div_ceil(4) * 4, 0);
    let mut words: Vec<u32> = padded.chunks(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    if words.len() % 2 == 1 {
        words.push(0);
    }
    words
}

/// The message schedule from the word `first_word` to the word 63.
fn expand_schedule(words: &mut [u32; 64], first_word: usize) {
    for index in first_word..64 {
        words[index] = sigma1(words[index - 2])
            .wrapping_add(words[index - 7])
            .wrapping_add(sigma0(words[index - 15]))
            .wrapping_add(words[index - 16]);
    }
}

/// The SHA-256 rounds from `first_round` to 63; returns the working registers (no final sum).
fn sha256_rounds(state: [u32; 8], words: &[u32; 64], constants: &[u32; 64], first_round: usize) -> [u32; 8] {
    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
    for index in first_round..64 {
        let t1 = h
            .wrapping_add(e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25))
            .wrapping_add(g ^ (e & (f ^ g)))
            .wrapping_add(constants[index])
            .wrapping_add(words[index]);
        let t2 = (a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22)).wrapping_add((a & b) | (c & (a | b)));
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(t1);
        d = c;
        c = b;
        b = a;
        a = t1.wrapping_add(t2);
    }
    [a, b, c, d, e, f, g, h]
}

fn add_state(x: [u32; 8], y: [u32; 8]) -> [u32; 8] {
    std::array::from_fn(|i| x[i].wrapping_add(y[i]))
}

/// The state after the salted first block, which ends with the first 7 bytes of the data
/// (`_sha256_init`).
fn sha256_init(data: &[u8; 7]) -> [u32; 8] {
    let mut words = [0u32; 64];
    words[14] = u32::from_be_bytes([0, data[0], data[1], data[2]]);
    words[15] = u32::from_be_bytes([data[3], data[4], data[5], data[6]]);
    for index in 16..30 {
        let mut value = SHA256_SCHEDULE[index - 16];
        if index - 2 >= 14 {
            let s1 = sigma1(words[index - 2]);
            value = value.wrapping_add(if index == 16 { s1 ^ SHA256_SIGMA1_ADJUSTMENT } else { s1 });
        }
        if index - 7 >= 14 {
            value = value.wrapping_add(words[index - 7]);
        }
        if index - 15 >= 14 {
            let s0 = sigma0(words[index - 15]);
            value = value.wrapping_add(if index == 29 { s0 ^ SHA256_SIGMA0_ADJUSTMENT } else { s0 });
        }
        words[index] = value;
    }
    words[30] = sigma1(words[28])
        .wrapping_add(words[23])
        .wrapping_add(sigma0(words[15]))
        .wrapping_add(words[14])
        .wrapping_add(SHA256_ADJUSTMENT)
        .wrapping_sub(SHA256_ROUND_CONSTANTS[14]);
    expand_schedule(&mut words, 31);
    let working = sha256_rounds(SHA256_STATE, &words, &SHA256_BLOCK_CONSTANTS, 14);
    add_state(SHA256_INITIAL, working)
}

/// The standard SHA-256 blocks from `state` over the padded message.
fn sha256_blocks(mut state: [u32; 8], padded: &[u8]) -> [u32; 8] {
    for block in padded.chunks(64) {
        let mut words = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            words[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        expand_schedule(&mut words, 16);
        state = add_state(state, sha256_rounds(state, &words, &SHA256_ROUND_CONSTANTS, 0));
    }
    state
}

/// The salted SHA-256 of the token data (`_sha256_digest`): a 57-byte salt stands before it.
fn sha256_digest(data: &[u8]) -> Result<[u8; 32], String> {
    if data.len() < 7 {
        return Err("the token data has fewer than seven bytes".into());
    }
    let length = 57 + data.len() as i64;
    let mut padded = data[7..].to_vec();
    padded.push(0x80);
    padded.resize(padded.len() + (55 - length).rem_euclid(64) as usize, 0);
    padded.extend_from_slice(&((length * 8) as u64).to_be_bytes());
    let first: [u8; 7] = data[..7].try_into().map_err(err)?;
    let state = sha256_blocks(sha256_init(&first), &padded);
    let mut digest = [0u8; 32];
    for (i, word) in state.iter().enumerate() {
        digest[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    Ok(digest)
}

/// The CS64 words of the token data (`_cs64_digest`).
fn cs64_digest(data: &[u8], digest: &[u8; 32]) -> (u32, u32) {
    let key_a = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]) | 1;
    let key_b = u32::from_le_bytes([digest[4], digest[5], digest[6], digest[7]]) | 1;
    let factors = [key_a.wrapping_mul(CS64_FACTOR), key_b.wrapping_mul(CS64_FACTOR)];
    let mut terms: Vec<u32> =
        CS64_COEFFICIENTS.iter().enumerate().map(|(i, (coefficient, _))| coefficient.wrapping_mul(factors[i % 2])).collect();
    let mut offsets: Vec<u32> = CS64_COEFFICIENTS.iter().map(|(_, offset)| *offset).collect();
    let mut input = vec![0u8];
    input.extend_from_slice(data);
    for (index, word) in words_le4_even(&input).into_iter().enumerate() {
        let even = index % 2 == 0;
        let mut term = word.wrapping_mul(if even { key_a } else { key_b });
        let mut offset = rol16(word).wrapping_mul(if even { 0xEF0569FB } else { 0xC31713DB });
        if index == 0 {
            term = term.wrapping_add(CS64_ADJUSTMENT0.wrapping_mul(factors[0]));
            offset = offset.wrapping_add(CS64_ADJUSTMENT1);
        }
        terms.push(term);
        offsets.push(offset);
    }
    let (mut swap_acc, mut swap_last, mut state, mut acc) = (0u32, 0u32, 0u32, 0u32);
    for index in (0..terms.len()).step_by(2) {
        let (x, y) = (terms[index], terms[index + 1]);
        let t = rol16(offsets[index].wrapping_add(x));
        let q = t.wrapping_mul(0x76F50F34);
        swap_acc = swap_acc.wrapping_add(rol16(q).wrapping_mul(0xC3EFEA97).wrapping_add(q));
        let t = rol16(offsets[index + 1].wrapping_add(y));
        let q = t.wrapping_mul(0x1881CE3C);
        swap_last = rol16(q).wrapping_mul(0x35BD1EC9).wrapping_add(q);
        swap_acc = swap_acc.wrapping_add(swap_last);

        state = state.wrapping_mul(key_a).wrapping_add(x);
        state = rol16(state).wrapping_mul(0xCF98B111);
        state = rol16(state).wrapping_mul(0x87085B9F);
        state = rol16(state).wrapping_mul(0x12CEB96D);
        state = rol16(state).wrapping_mul(0x257E1D83);
        acc = acc.wrapping_add(state);
        let t = state.wrapping_mul(key_b).wrapping_add(y);
        let t = rol16(t).wrapping_mul(0xA27416F5);
        let t = rol16(t).wrapping_mul(0xD38396FF);
        state = rol16(rol16(t).wrapping_mul(0x7C932B89)).wrapping_mul(0xBFA49F69);
        acc = acc.wrapping_add(state);
    }
    (swap_last ^ state, swap_acc ^ acc)
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// The token of the 5-minute window of `unix_seconds` (`generate_sec_ms_gec_v2`).
pub(crate) fn token(unix_seconds: u64) -> String {
    let seconds = unix_seconds + WIN_EPOCH;
    let ticks = (seconds - seconds % 300) * 10_000_000;
    let data = format!("{ticks}{TRUSTED_CLIENT_TOKEN}");
    let digest = sha256_digest(data.as_bytes()).expect("the token data has more than seven bytes");
    let (low, high) = cs64_digest(data.as_bytes(), &digest);
    let mut cs64 = low.to_le_bytes().to_vec();
    cs64.extend_from_slice(&high.to_le_bytes());
    format!("{}-{}", hex_upper(&cs64), hex_upper(&digest))
}

// ---------------------------------------------------------------------------------------------
// The messages of the protocol.
// ---------------------------------------------------------------------------------------------

/// The address of one connection.
pub(crate) fn connect_url(token: &str, connection_id: &str) -> String {
    format!(
        "{SERVICE}?TrustedClientToken={TRUSTED_CLIENT_TOKEN}&ConnectionId={connection_id}&Sec-MS-GEC={token}&Sec-MS-GEC-Version=2-{CHROMIUM_FULL_VERSION}"
    )
}

/// The year, month and day of a day count from 1970-01-01 (H. Hinnant, `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// The JavaScript form of a UTC time: `Mon Nov 23 2026 11:13:00 GMT+0000 (Coordinated Universal Time)`.
pub(crate) fn date_string(unix_seconds: u64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let days = (unix_seconds / 86_400) as i64;
    let rest = unix_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{} {} {:02} {} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        DAYS[((days + 4) % 7) as usize],
        MONTHS[(month - 1) as usize],
        day,
        year,
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

/// The first message: the audio format, MP3 at 24 kHz.
pub(crate) fn config_message(date: &str) -> String {
    format!(
        "X-Timestamp:{date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}\r\n"
    )
}

/// The second message: the text in SSML. The `Z` after the date is as in Edge.
pub(crate) fn ssml_message(request_id: &str, date: &str, voice: &str, text: &str) -> String {
    format!(
        "X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{date}Z\r\nPath:ssml\r\n\r\n\
         <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>{}</prosody></voice></speak>",
        full_voice_name(voice),
        escape(text)
    )
}

/// The text for XML; the control characters that the service refuses become spaces.
pub(crate) fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\u{0}'..='\u{8}' | '\u{b}'..='\u{c}' | '\u{e}'..='\u{1f}' => out.push(' '),
            _ => out.push(c),
        }
    }
    out
}

/// `en-US-AvaNeural` → `Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)`.
pub(crate) fn full_voice_name(voice: &str) -> String {
    match voice.get(..5) {
        Some(locale) if voice.len() > 6 => {
            format!("Microsoft Server Speech Text to Speech Voice ({locale}, {})", &voice[6..])
        }
        _ => voice.to_string(),
    }
}

/// A voice name of the form `en-US-AvaNeural`.
fn valid_voice(voice: &str) -> bool {
    let b = voice.as_bytes();
    b.len() > 6
        && b[0..2].iter().all(u8::is_ascii_lowercase)
        && b[2] == b'-'
        && b[3..5].iter().all(u8::is_ascii_uppercase)
        && b[5] == b'-'
        && b[6..].iter().all(u8::is_ascii_alphabetic)
}

fn check_input(voice: &str, text: &str) -> Result<(), String> {
    if !valid_voice(voice) {
        return Err(format!("not a voice name: {voice}"));
    }
    if text.trim().is_empty() || text.chars().count() > MAX_TEXT {
        return Err(format!("the text must have 1 to {MAX_TEXT} characters"));
    }
    Ok(())
}

/// The header lines of a message, up to the empty line.
fn header_has(header: &[u8], line: &str) -> bool {
    header.split(|&b| b == b'\n').any(|l| l.strip_suffix(b"\r").unwrap_or(l) == line.as_bytes())
}

/// The audio of a binary frame: 2 bytes (big endian) give the length of the header, then the
/// header, then the audio. A frame whose header has no `Path:audio` gives none.
pub(crate) fn audio_of_frame(frame: &[u8]) -> Option<&[u8]> {
    if frame.len() < 2 {
        return None;
    }
    let length = u16::from_be_bytes([frame[0], frame[1]]) as usize;
    let header = frame.get(2..2 + length)?;
    header_has(header, "Path:audio").then(|| &frame[2 + length..])
}

/// A text frame that ends the turn: the service sent all the audio.
pub(crate) fn is_turn_end(text: &str) -> bool {
    let header = text.split("\r\n\r\n").next().unwrap_or("");
    header_has(header.as_bytes(), "Path:turn.end")
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|e| format!("no random bytes for the voice: {e}"))?;
    Ok(hex_upper(&buffer))
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The MP3 of one phrase from the service, in at most `TIMEOUT`.
pub(crate) async fn fetch(voice: &str, text: &str) -> Result<Vec<u8>, String> {
    check_input(voice, text)?;
    match tokio::time::timeout(TIMEOUT, fetch_now(voice, text, now_seconds())).await {
        Ok(result) => result,
        Err(_) => Err(timeout_text()),
    }
}

/// The error of a line that the service did not finish in time.
fn timeout_text() -> String {
    format!("the voice service did not send the whole line in {} seconds", TIMEOUT.as_secs())
}

async fn fetch_now(voice: &str, text: &str, now: u64) -> Result<Vec<u8>, String> {
    let url = connect_url(&token(now), &random_hex(16)?.to_lowercase());
    let mut request = url.into_client_request().map_err(err)?;
    let user_agent = format!(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
         Chrome/{CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/{CHROMIUM_MAJOR_VERSION}.0.0.0"
    );
    let cookie = format!("muid={};", random_hex(16)?);
    let headers = request.headers_mut();
    headers.insert("Pragma", HeaderValue::from_static("no-cache"));
    headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    headers.insert("Origin", HeaderValue::from_static(ORIGIN));
    headers.insert("User-Agent", HeaderValue::from_str(&user_agent).map_err(err)?);
    headers.insert("Accept-Encoding", HeaderValue::from_static("gzip, deflate, br, zstd"));
    headers.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert("Cookie", HeaderValue::from_str(&cookie).map_err(err)?);

    let (mut socket, _) =
        tokio_tungstenite::connect_async(request).await.map_err(|e| format!("the voice service refused the connection: {e}"))?;
    let date = date_string(now);
    socket.send(Message::text(config_message(&date))).await.map_err(|e| format!("the voice service took no request: {e}"))?;
    let request_id = random_hex(16)?.to_lowercase();
    socket.send(Message::text(ssml_message(&request_id, &date, voice, text))).await.map_err(|e| format!("the voice service took no request: {e}"))?;

    let mut audio = Vec::new();
    while let Some(message) = socket.next().await {
        match message.map_err(|e| format!("the voice service broke off the line: {e}"))? {
            Message::Text(text) if is_turn_end(text.as_str()) => break,
            Message::Binary(frame) => {
                if let Some(bytes) = audio_of_frame(&frame) {
                    audio.extend_from_slice(bytes);
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    let _ = socket.close(None).await;
    if audio.is_empty() {
        return Err("the voice service sent no audio".into());
    }
    Ok(audio)
}

// ---------------------------------------------------------------------------------------------
// The cache of the phrases.
// ---------------------------------------------------------------------------------------------

/// The file of one phrase: the SHA-256 of `<voice>\n<text>`.
pub(crate) fn cache_path(dir: &Path, voice: &str, text: &str) -> PathBuf {
    let hash = Sha256::digest(format!("{voice}\n{text}").as_bytes());
    dir.join(format!("{}.mp3", hex_upper(&hash).to_lowercase()))
}

/// The audio of a phrase that the app made before.
pub(crate) fn cached(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok().filter(|bytes| !bytes.is_empty())
}

/// Keeps a phrase: a temporary name first, then the rename, then at most 300 files.
pub(crate) fn store(dir: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(err)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(err)?;
    fs::rename(&temporary, path).map_err(err)?;
    prune(dir, MAX_FILES)
}

/// Removes the oldest phrases (by the time of change) until `max` stay.
fn prune(dir: &Path, max: usize) -> Result<(), String> {
    let mut files: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)
        .map_err(err)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "mp3"))
        .map(|path| (fs::metadata(&path).and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), path))
        .collect();
    if files.len() <= max {
        return Ok(());
    }
    files.sort();
    for (_, path) in &files[..files.len() - max] {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// The MP3 of a phrase: from the cache, else from the service (then kept in the cache).
pub(crate) async fn speech(core: &Core, voice: &str, text: &str) -> Result<Vec<u8>, String> {
    check_input(voice, text)?;
    let dir = core.app_data_dir()?.join(CACHE_FOLDER);
    let path = cache_path(&dir, voice, text);
    if let Some(bytes) = cached(&path) {
        return Ok(bytes);
    }
    let bytes = fetch(voice, text).await?;
    if let Err(e) = store(&dir, &path, &bytes) {
        eprintln!("the voice cache did not keep the phrase: {e}");
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_upper_hex(text: &str) -> bool {
        text.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
    }

    #[test]
    fn the_token_has_16_hex_a_dash_and_64_hex_in_upper_case() {
        let token = token(1_795_000_000);
        let (cs64, sha) = token.split_once('-').expect("a dash");
        assert_eq!(cs64.len(), 16);
        assert_eq!(sha.len(), 64);
        assert!(is_upper_hex(cs64) && is_upper_hex(sha), "{token}");
    }

    #[test]
    fn one_5_minute_window_gives_one_token_and_two_windows_give_two() {
        // 1_795_000_200 + WIN_EPOCH is a multiple of 300: a window starts there.
        let start = 1_795_000_200;
        assert_eq!((start + WIN_EPOCH) % 300, 0);
        assert_eq!(token(start), token(start + 299));
        assert_ne!(token(start), token(start + 300));
        assert_ne!(token(start - 1), token(start));
    }

    #[test]
    fn the_rounds_and_the_schedule_give_the_standard_sha256() {
        // The same rounds without the salt are the standard SHA-256: the hash of "abc".
        let mut padded = b"abc".to_vec();
        padded.push(0x80);
        padded.resize(56, 0);
        padded.extend_from_slice(&24u64.to_be_bytes());
        let state = sha256_blocks(SHA256_INITIAL, &padded);
        let digest: Vec<u8> = state.iter().flat_map(|w| w.to_be_bytes()).collect();
        assert_eq!(digest, Sha256::digest(b"abc").to_vec());
    }

    #[test]
    fn the_token_data_needs_seven_bytes() {
        assert!(sha256_digest(b"123456").is_err());
        assert!(sha256_digest(b"1234567").is_ok());
    }

    #[test]
    fn the_cs64_words_are_little_endian_and_even() {
        assert_eq!(words_le4_even(b""), Vec::<u32>::new());
        assert_eq!(words_le4_even(&[1]), vec![1, 0]);
        assert_eq!(words_le4_even(&[1, 0, 0, 0, 2]), vec![1, 2]);
    }

    #[test]
    fn escape_replaces_the_five_xml_characters_and_the_control_characters() {
        assert_eq!(escape(r#"a & b < c > d " e ' f"#), "a &amp; b &lt; c &gt; d &quot; e &apos; f");
        assert_eq!(escape("a\u{b}b\nc"), "a b\nc");
    }

    #[test]
    fn the_messages_carry_their_path_headers() {
        let date = date_string(1_795_000_000);
        let config = config_message(&date);
        assert!(config.starts_with(&format!("X-Timestamp:{date}\r\n")));
        assert!(config.contains("\r\nPath:speech.config\r\n\r\n{"));
        assert!(config.contains("\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\""));
        assert!(config.ends_with("}}}}\r\n"));

        let ssml = ssml_message("abc", &date, "en-US-AvaNeural", "Fish & chips");
        assert!(ssml.starts_with("X-RequestId:abc\r\nContent-Type:application/ssml+xml\r\n"));
        assert!(ssml.contains(&format!("X-Timestamp:{date}Z\r\nPath:ssml\r\n\r\n<speak ")));
        assert!(ssml.contains("<voice name='Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)'>"));
        assert!(ssml.contains(">Fish &amp; chips</prosody></voice></speak>"));
    }

    #[test]
    fn the_date_has_the_javascript_form() {
        // 2026-11-23 11:13:00 UTC is a Monday.
        assert_eq!(date_string(1_795_432_380), "Mon Nov 23 2026 11:13:00 GMT+0000 (Coordinated Universal Time)");
        assert_eq!(date_string(0), "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)");
    }

    #[test]
    fn the_time_limit_lets_a_slow_line_finish_and_names_itself() {
        // The slowest line measured took 10.6 seconds; the page queue lets a line run 60 seconds.
        assert!(TIMEOUT >= Duration::from_secs(20));
        assert!(TIMEOUT <= Duration::from_secs(40));
        assert_eq!(timeout_text(), format!("the voice service did not send the whole line in {} seconds", TIMEOUT.as_secs()));
    }

    #[test]
    fn the_url_holds_the_token_and_the_version() {
        let url = connect_url("T-K", "c0ffee");
        assert!(url.starts_with("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?"));
        assert!(url.contains("TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4"));
        assert!(url.contains("&ConnectionId=c0ffee&Sec-MS-GEC=T-K&Sec-MS-GEC-Version=2-143.0.3650.75"));
    }

    #[test]
    fn the_voice_names_and_the_text_are_checked() {
        assert!(check_input("en-US-AvaMultilingualNeural", "Hello").is_ok());
        assert!(check_input("en-us-AvaNeural", "Hello").is_err());
        assert!(check_input("en-US-Ava Neural", "Hello").is_err());
        assert!(check_input("en-US-", "Hello").is_err());
        assert!(check_input("en-US-AvaNeural", " ").is_err());
        assert!(check_input("en-US-AvaNeural", &"a".repeat(501)).is_err());
        assert!(check_input("en-US-AvaNeural", &"a".repeat(500)).is_ok());
    }

    fn frame(header: &str, audio: &[u8]) -> Vec<u8> {
        let mut frame = (header.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(header.as_bytes());
        frame.extend_from_slice(audio);
        frame
    }

    #[test]
    fn a_binary_frame_yields_its_audio_and_another_path_yields_none() {
        let audio = frame("X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nX-StreamId:1\r\nPath:audio\r\n", &[0xFF, 0xF3, 1, 2]);
        assert_eq!(audio_of_frame(&audio), Some(&[0xFF, 0xF3, 1, 2][..]));
        let other = frame("X-RequestId:abc\r\nPath:audio.metadata\r\n", &[1, 2]);
        assert_eq!(audio_of_frame(&other), None);
        assert_eq!(audio_of_frame(&[0]), None);
        assert_eq!(audio_of_frame(&[0, 50, 1]), None);
    }

    #[test]
    fn the_turn_end_is_found_in_the_header() {
        assert!(is_turn_end("X-RequestId:abc\r\nContent-Type:application/json\r\nPath:turn.end\r\n\r\n{}"));
        assert!(!is_turn_end("X-RequestId:abc\r\nPath:turn.start\r\n\r\n{}"));
        assert!(!is_turn_end("X-RequestId:abc\r\nPath:response\r\n\r\nPath:turn.end"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dispatch-voice-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_cache_path_depends_on_the_voice_and_the_text() {
        let dir = Path::new("cache");
        let one = cache_path(dir, "en-US-AvaNeural", "Hello");
        assert_eq!(one, cache_path(dir, "en-US-AvaNeural", "Hello"));
        assert_ne!(one, cache_path(dir, "en-US-EmmaNeural", "Hello"));
        assert_ne!(one, cache_path(dir, "en-US-AvaNeural", "Hello."));
        assert_eq!(one.extension().unwrap(), "mp3");
    }

    #[test]
    fn the_cache_gives_back_what_it_stored() {
        let dir = temp_dir("roundtrip");
        let path = cache_path(&dir, "en-US-AvaNeural", "Hello");
        assert_eq!(cached(&path), None);
        store(&dir, &path, &[1, 2, 3]).unwrap();
        assert_eq!(cached(&path), Some(vec![1, 2, 3]));
        assert!(!path.with_extension("tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_store_keeps_at_most_300_files_and_removes_the_oldest() {
        let dir = temp_dir("prune");
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.mp3");
        fs::write(&old, [1]).unwrap();
        let file = fs::File::options().write(true).open(&old).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(1_000_000)).unwrap();
        drop(file);
        for i in 0..MAX_FILES {
            fs::write(dir.join(format!("{i}.mp3")), [1]).unwrap();
        }
        let path = cache_path(&dir, "en-US-AvaNeural", "Hello");
        store(&dir, &path, &[1, 2, 3]).unwrap();
        let count = fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, MAX_FILES);
        assert!(!old.exists());
        assert!(path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    /// The proof that the service accepts the token today. It needs the network:
    /// `cargo test --manifest-path src-tauri/Cargo.toml live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_service_speaks_one_line() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let audio = runtime
            .block_on(fetch("en-US-AvaMultilingualNeural", "Dispatch in this project. The plan is ready."))
            .expect("the service gives audio");
        println!("the service gave {} bytes", audio.len());
        assert!(audio.len() > 1000);
        let mp3 = audio.starts_with(b"ID3") || (audio[0] == 0xFF && matches!(audio[1], 0xFB | 0xF3 | 0xF2));
        assert!(mp3, "the audio starts with {:02X?}", &audio[..4]);
    }

    /// The phrases of `SPOKEN` in `src/alerts.ts`, one per alert event.
    const SPOKEN_PHRASES: [&str; 12] = [
        "The plan is ready",
        "The plan needs your decision",
        "It waits for your answer",
        "It needs a permission",
        "It waits at a permission prompt",
        "The checks wait for your click",
        "The task is done",
        "The plan run ended without a plan",
        "The work run ended without a report",
        "The plan run failed",
        "The work run failed",
        "It waits for other tasks to merge",
    ];

    /// Each alert line of each event, with a plain title and with a title in quotes, gives audio.
    #[test]
    #[ignore]
    fn live_service_speaks_the_line_of_each_event() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let titles = ["Terminals need borders around windows", "Voice said that \"task is done\" but i had to answer these questions"];
        let mut failures = Vec::new();
        for title in titles {
            for phrase in SPOKEN_PHRASES {
                let line = format!("{title} in dispatch. {phrase}.");
                match runtime.block_on(fetch("en-US-AvaMultilingualNeural", &line)) {
                    Ok(audio) => println!("ok {} bytes: {line}", audio.len()),
                    Err(e) => {
                        println!("FAILED: {line}: {e}");
                        failures.push(line);
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{} lines failed", failures.len());
    }

    /// The token of the 5-minute window before and after the one of the clock: the service takes
    /// both, so a clock that is a few seconds off near the edge of a window is not why a line fails.
    #[test]
    #[ignore]
    fn live_service_accepts_the_token_of_the_next_and_the_last_window() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        for offset in [-300i64, 300] {
            let at = now_seconds().saturating_add_signed(offset);
            let result = runtime.block_on(fetch_now("en-US-AvaMultilingualNeural", "The clock test.", at));
            println!("{offset} seconds: {:?}", result.as_ref().map(Vec::len));
            assert!(result.is_ok(), "{offset} seconds: {result:?}");
        }
    }
}
