//! The start-up check for the web view runtime, on a computer where the runtime cannot be found.
//! Its own test binary: pointing the runtime loader at an empty folder changes the whole process.

#[cfg(windows)]
#[test]
fn a_runtime_that_cannot_be_found_gets_the_message() {
    let empty = tempfile::tempdir().unwrap();
    // The loader looks only in this folder when it is set, as it would for a fixed-version runtime.
    // SAFETY: this test binary runs this one test; no other thread reads the environment.
    unsafe { std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", empty.path()) };
    let message = openquote_care_lib::runtime::check().expect("an empty folder holds no runtime");
    assert!(message.body.contains("WebView2"));
}

