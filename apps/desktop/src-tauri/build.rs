fn main() {
    // The target triple, so a debug build finds the Node the stage script
    // fetched for it (`binaries/node-<triple>`).
    println!(
        "cargo:rustc-env=ODDBORO_TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    // The release's report address, read by `option_env!` in
    // `src/diagnostics.rs`. Without this a cached build keeps an old value.
    println!("cargo:rerun-if-env-changed=ODDBORO_DIAGNOSTICS_DSN");
    tauri_build::build()
}
