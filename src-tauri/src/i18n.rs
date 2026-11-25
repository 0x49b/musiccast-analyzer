//! Language of everything the Rust side says to the user: native menus, notifications,
//! error messages and step descriptions. English is the default, German the second language.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    De,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::De => "de",
        }
    }

    pub fn parse(code: &str) -> Option<Lang> {
        match code.trim().to_ascii_lowercase().as_str() {
            "en" => Some(Lang::En),
            "de" => Some(Lang::De),
            _ => None,
        }
    }
}

pub fn lang() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::De,
        _ => Lang::En,
    }
}

pub fn set(lang: Lang) {
    CURRENT.store(if lang == Lang::De { 1 } else { 0 }, Ordering::Relaxed);
}

/// Returns the text for the current language.
pub fn pick<'a>(en: &'a str, de: &'a str) -> &'a str {
    match lang() {
        Lang::En => en,
        Lang::De => de,
    }
}
