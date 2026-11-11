// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The sign-in entry of "Run the host on this PC": start the host without a window and end.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--start-host") {
        std::process::exit(dispatch_lib::core::hostrun::start_from_args(&args[1..]));
    }
    dispatch_lib::run()
}
