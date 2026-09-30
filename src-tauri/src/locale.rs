//! The language the app speaks. The window and the shell's own messages follow the system's display
//! language; `OPENQUOTE_UI_LOCALE` overrides it (tests and support use it to fix the language). What a
//! vault's data packs name — classifications, fields, forms — follows the vault, not this.

/// The environment variable that fixes the app's language, as a language tag such as `en` or `fr-CA`.
pub const OVERRIDE: &str = "OPENQUOTE_UI_LOCALE";

/// The app's language as a BCP 47 tag: the override when set, else the system's display language,
/// else `en`.
pub fn ui_locale() -> String {
    choose(std::env::var(OVERRIDE).ok(), system())
}

fn choose(overridden: Option<String>, system: Option<String>) -> String {
    [overridden, system]
        .into_iter()
        .flatten()
        .map(|tag| tag.trim().to_owned())
        .find(|tag| !tag.is_empty())
        .unwrap_or_else(|| "en".to_owned())
}

/// The language of a tag, lower-cased: `fr` for `fr-CA`.
pub fn language(tag: &str) -> String {
    tag.split('-').next().unwrap_or_default().to_ascii_lowercase()
}

/// The first of the person's preferred display languages, from Windows.
#[cfg(windows)]
fn system() -> Option<String> {
    use windows_sys::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};
    let (mut count, mut size) = (0u32, 0u32);
    // SAFETY: a null buffer asks only for the size, written to `size`.
    if unsafe { GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, std::ptr::null_mut(), &mut size) } == 0 {
        return None;
    }
    let mut buffer = vec![0u16; size as usize];
    // SAFETY: the buffer holds `size` UTF-16 units, as the first call asked for.
    if unsafe { GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, buffer.as_mut_ptr(), &mut size) } == 0 {
        return None;
    }
    // A list of NUL-terminated names, ending with an empty one: the first is the preferred language.
    let first = buffer.split(|&c| c == 0).next()?;
    Some(String::from_utf16_lossy(first)).filter(|tag| !tag.is_empty())
}

#[cfg(not(windows))]
fn system() -> Option<String> {
    std::env::var("LANG").ok().map(|lang| lang.split(['.', '@']).next().unwrap_or_default().replace('_', "-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_override_names_the_ui_language() {
        assert_eq!(choose(Some("en".into()), Some("ko-KR".into())), "en");
        assert_eq!(choose(Some("  ".into()), Some("ko-KR".into())), "ko-KR");
        assert_eq!(choose(None, Some("ko-KR".into())), "ko-KR");
        assert_eq!(choose(None, None), "en");
    }

    #[test]
    fn a_tag_names_its_language() {
        assert_eq!(language("ko-KR"), "ko");
        assert_eq!(language("EN"), "en");
    }

    #[cfg(windows)]
    #[test]
    fn windows_names_a_display_language() {
        assert!(system().is_some_and(|tag| !tag.is_empty()));
    }
}
