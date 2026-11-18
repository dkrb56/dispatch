use std::path::Path;
use std::{env, fs};

/// The page of a host whose build did not make `dist/phone` first.
const NOT_BUILT: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Dispatch</title></head><body><p>The phone page was not built. Run npm run build, then build the host again.</p></body></html>";

fn main() {
    tauri_build::build();
    phone_files();
}

/// One constant with the bytes of `file`, or with `missing` when the file is not there.
fn entry(name: &str, file: &Path, missing: &str) -> String {
    println!("cargo:rerun-if-changed={}", file.display());
    if file.is_file() {
        format!("const {name}: &[u8] = include_bytes!({:?});\n", file.display().to_string())
    } else {
        format!("const {name}: &[u8] = {missing:?}.as_bytes();\n")
    }
}

/// Writes `phone_files.rs` for `src/host/phone.rs`: the files of the phone page and its icon. Without
/// `dist/phone` a short page stands in, so `cargo test` works without a build of the page.
fn phone_files() {
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let manifest = Path::new(&manifest);
    let page = manifest.parent().expect("src-tauri has a parent folder").join("dist").join("phone");
    println!("cargo:rerun-if-changed={}", page.display());
    let text = [
        entry("PHONE_HTML", &page.join("phone.html"), NOT_BUILT),
        entry("PHONE_JS", &page.join("phone.js"), ""),
        entry("PHONE_CSS", &page.join("phone.css"), ""),
        entry("PHONE_ICON", &manifest.join("icons").join("128x128@2x.png"), ""),
    ]
    .concat();
    let out = env::var("OUT_DIR").expect("cargo sets OUT_DIR");
    fs::write(Path::new(&out).join("phone_files.rs"), text).expect("OUT_DIR takes the file");
}
