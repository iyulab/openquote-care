//! How suggestions are used, counted on this device and sent as declared events — content-free by
//! construction.
//!
//! When a record is saved, the window tells the shell for each coded field whether the field showed
//! suggestions, what the person did with the first one (kept it, chose another value, or filled in a
//! field that showed none), whether that suggestion was one the suggester stood behind, and how long the
//! person looked at them before deciding. The shell adds this up in a file in the app's data folder, per
//! week (the Monday starting it) and per field — counts only: no value, no record, no person, no folder.
//! A week that has ended is written as three declared events (see `diagnostics-registry.json`: `week`
//! is the week's number in the year, `field` one of the declared field names or `other`), and sent like
//! the other diagnostics: when there is no network, nothing is shown and nothing waits — the lines stay for
//! a later launch.

use std::collections::{BTreeMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri_kit_diagnostics::{Events, Registry, Value};

/// The most one declared count carries (`diagnostics-registry.json`); a larger tally is written in parts.
const MOST: u64 = 1000;

/// The waits a suggestion was looked at before a decision, in milliseconds, as the registry names them:
/// under half a second, a second, 2, 4, 8, 16, 32 seconds, and longer.
const WAIT_EDGES_MS: [u64; 7] = [500, 1000, 2000, 4000, 8000, 16000, 32000];
const WAITS: [&str; 8] = ["lt0_5", "lt1", "lt2", "lt4", "lt8", "lt16", "lt32", "more"];

/// What a person did with a field's suggestions when the record was saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    /// The field's value is the first suggestion.
    Accepted,
    /// The field showed suggestions and has another value.
    Corrected,
    /// The field showed no suggestion and has a value.
    Entered,
    /// The field has no value.
    None,
}

/// One coded field of a saved record, as the window reports it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Use {
    /// The field, as `<kind of record>.<field>`.
    pub field: String,
    /// The field showed suggestions.
    pub shown: bool,
    pub decision: Decision,
    /// The first suggestion was one the suggester stood behind.
    pub trusted: bool,
    /// From the suggestions first showing to the field getting its value, when it did.
    pub wait_ms: Option<u64>,
}

/// Counts for one field in one week.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tally {
    presented: u64,
    accepted: u64,
    corrected: u64,
    entered: u64,
    trusted_shown: u64,
    trusted_taken: u64,
    wait: [u64; 8],
}

type Weeks = BTreeMap<String, BTreeMap<String, Tally>>;

/// The fields the registry declares for the events, to tell a declared name from any other.
pub struct Names {
    fields: HashSet<String>,
}

impl Names {
    pub fn of(registry_json: &str) -> Names {
        let parsed: serde_json::Value = serde_json::from_str(registry_json).unwrap_or_default();
        let fields = parsed["events"]["suggestion.use"]["fields"]["field"]["values"]
            .as_array()
            .map(|values| values.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default();
        Names { fields }
    }

    /// The field as the registry names it, `other` for one it does not.
    pub fn field(&self, raw: &str) -> &str {
        match self.fields.get(raw) {
            Some(name) => name,
            None => "other",
        }
    }
}

/// The weekly tallies, kept in one file.
pub struct Counter {
    file: PathBuf,
    names: Names,
    lock: Mutex<()>,
}

impl Counter {
    pub fn new(file: PathBuf, names: Names) -> Counter {
        Counter { file, names, lock: Mutex::new(()) }
    }

    fn load(&self) -> Weeks {
        std::fs::read(&self.file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    /// Written whole beside itself and moved into place, so a launch that ends mid-write loses nothing.
    fn save(&self, weeks: &Weeks) -> io::Result<()> {
        if weeks.is_empty() {
            return match std::fs::remove_file(&self.file) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
                _ => Ok(()),
            };
        }
        let beside = self.file.with_extension("json.tmp");
        std::fs::write(&beside, serde_json::to_vec(weeks).map_err(io::Error::other)?)?;
        std::fs::rename(&beside, &self.file)
    }

    /// Adds a saved record's fields to the week starting on the Monday `week` names.
    pub fn add(&self, week: &str, uses: &[Use]) -> io::Result<()> {
        let _held = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut weeks = self.load();
        for used in uses {
            if !used.shown && used.decision == Decision::None {
                continue;
            }
            let tally = weeks.entry(week.to_owned()).or_default().entry(self.names.field(&used.field).to_owned()).or_default();
            if used.shown {
                tally.presented += 1;
                if used.trusted {
                    tally.trusted_shown += 1;
                }
            }
            match used.decision {
                Decision::Accepted => {
                    tally.accepted += 1;
                    if used.trusted {
                        tally.trusted_taken += 1;
                    }
                }
                Decision::Corrected => tally.corrected += 1,
                Decision::Entered => tally.entered += 1,
                Decision::None => {}
            }
            if used.shown
                && matches!(used.decision, Decision::Accepted | Decision::Corrected)
                && let Some(ms) = used.wait_ms
            {
                let bin = WAIT_EDGES_MS.iter().position(|edge| ms < *edge).unwrap_or(WAITS.len() - 1);
                tally.wait[bin] += 1;
            }
        }
        self.save(&weeks)
    }

    /// Writes every week before the one starting on `current` as events, and forgets what was written.
    /// Returns how many weeks went out of the tally. Stops at the first week the file cannot take.
    pub fn flush(&self, current: &str, events: &Events, registry: &Registry) -> io::Result<usize> {
        let _held = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut weeks = self.load();
        let ended: Vec<String> = weeks.keys().filter(|week| week.as_str() < current).cloned().collect();
        let mut done = 0;
        for week in ended {
            let number = week_number(&week).unwrap_or(0);
            let Ok(use_event) = registry.event("suggestion.use") else { break };
            let Ok(trust_event) = registry.event("suggestion.trust") else { break };
            let Ok(dwell_event) = registry.event("suggestion.dwell") else { break };
            for (field, tally) in &weeks[&week] {
                let head = |field: &str| [("week", Value::Count(number)), ("field", Value::Choice(field.to_owned()))];
                for (presented, accepted, corrected, entered) in parts4(tally.presented, tally.accepted, tally.corrected, tally.entered) {
                    let [w, f] = head(field);
                    put(events, &use_event, &[w, f, ("presented", Value::Count(presented)), ("accepted", Value::Count(accepted)), ("corrected", Value::Count(corrected)), ("entered", Value::Count(entered))])?;
                }
                for (shown, taken, _, _) in parts4(tally.trusted_shown, tally.trusted_taken, 0, 0) {
                    let [w, f] = head(field);
                    put(events, &trust_event, &[w, f, ("shown", Value::Count(shown)), ("taken", Value::Count(taken))])?;
                }
                for (bin, times) in tally.wait.iter().enumerate() {
                    for (part, _, _, _) in parts4(*times, 0, 0, 0) {
                        if part == 0 {
                            continue;
                        }
                        let [w, f] = head(field);
                        put(events, &dwell_event, &[w, f, ("wait", Value::Choice(WAITS[bin].to_owned())), ("times", Value::Count(part))])?;
                    }
                }
            }
            weeks.remove(&week);
            self.save(&weeks)?;
            done += 1;
        }
        Ok(done)
    }
}

/// Writes one event. One the registry would not take is dropped by the crate, which counts it and says so
/// in the stream; that is not a failure of the file, so the week still goes out of the tally.
fn put(events: &Events, event: &tauri_kit_diagnostics::EventName, fields: &[(&str, Value)]) -> io::Result<()> {
    events.record(event, fields).map(|_| ())
}

/// Four counts as parts none of which is over [`MOST`]: the same four counts when they fit, else as many
/// parts as the largest needs, each count spread over them. A tally of all zeros gives nothing.
fn parts4(a: u64, b: u64, c: u64, d: u64) -> Vec<(u64, u64, u64, u64)> {
    let largest = a.max(b).max(c).max(d);
    if largest == 0 {
        return Vec::new();
    }
    let n = largest.div_ceil(MOST);
    let share = |total: u64, i: u64| total / n + u64::from(i < total % n);
    (0..n).map(|i| (share(a, i), share(b, i), share(c, i), share(d, i))).collect()
}

/// The days since 1970-01-01 as a civil date `(year, month, day)`.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// The days since 1970-01-01 of a civil date.
fn days_of(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The Monday starting the week that holds `days` (since 1970-01-01, a Thursday), as `YYYY-MM-DD`.
pub fn week_of(days: i64) -> String {
    let (year, month, day) = civil(days - (days + 3).rem_euclid(7));
    format!("{year:04}-{month:02}-{day:02}")
}

/// The week starting today's Monday, by the clock in UTC.
pub fn this_week() -> String {
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    week_of((seconds / 86_400) as i64)
}

/// A week's number in its year (ISO 8601) from the `YYYY-MM-DD` of its Monday.
pub fn week_number(monday: &str) -> Option<u64> {
    let mut parts = monday.split('-');
    let (year, month, day): (i64, u32, u32) = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    let thursday = days_of(year, month, day) + 3;
    let (thursday_year, _, _) = civil(thursday);
    Some(((thursday - days_of(thursday_year, 1, 1)) / 7 + 1) as u64)
}

/// The tally file's place beside the other diagnostics.
pub fn file_in(folder: &Path) -> PathBuf {
    folder.join("suggestion-use.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counter(dir: &Path) -> Counter {
        Counter::new(file_in(dir), Names::of(crate::diagnostics::REGISTRY))
    }

    fn used(field: &str, shown: bool, decision: Decision, trusted: bool, wait_ms: Option<u64>) -> Use {
        Use { field: field.into(), shown, decision, trusted, wait_ms }
    }

    #[test]
    fn a_week_starts_on_its_monday_and_is_numbered_the_iso_way() {
        // 2026-10-18 is a Sunday: its week began on Monday the 12th.
        assert_eq!(week_of(days_of(2026, 10, 18)), "2026-10-12");
        assert_eq!(week_of(days_of(2026, 10, 12)), "2026-10-12");
        assert_eq!(week_of(days_of(2026, 10, 19)), "2026-10-19");
        assert_eq!(week_number("2026-10-12"), Some(42));
        // The week of Thursday 2026-01-01 is week 1, and the Monday before it belongs to it.
        assert_eq!(week_of(days_of(2026, 1, 1)), "2025-12-29");
        assert_eq!(week_number("2025-12-29"), Some(1));
        assert_eq!(week_number("2021-01-04"), Some(1));
        assert_eq!(week_number("2020-12-28"), Some(53));
    }

    #[test]
    fn what_a_person_does_with_suggestions_is_counted_per_field_and_week() {
        let dir = tempfile::tempdir().unwrap();
        let counter = counter(dir.path());
        counter
            .add(
                "2026-10-12",
                &[
                    used("session.topic", true, Decision::Accepted, true, Some(700)),
                    used("session.topic", true, Decision::Corrected, false, Some(40_000)),
                    used("session.topic", false, Decision::Entered, false, None),
                    used("session.mode", true, Decision::None, false, None),
                    used("session.mode", false, Decision::None, false, None),
                    used("somewhere.else", true, Decision::Accepted, false, Some(100)),
                ],
            )
            .unwrap();
        let weeks = counter.load();
        let topic = &weeks["2026-10-12"]["session.topic"];
        assert_eq!((topic.presented, topic.accepted, topic.corrected, topic.entered), (2, 1, 1, 1));
        assert_eq!((topic.trusted_shown, topic.trusted_taken), (1, 1));
        assert_eq!(topic.wait, [0, 1, 0, 0, 0, 0, 0, 1]);
        assert_eq!(weeks["2026-10-12"]["session.mode"].presented, 1, "shown and left empty is still shown");
        assert!(weeks["2026-10-12"].contains_key("other"), "a name the registry does not declare is counted as other");
        assert!(!weeks["2026-10-12"].contains_key("somewhere.else"));
    }

    #[test]
    fn a_tally_over_the_most_a_count_carries_goes_out_in_parts_that_add_up() {
        let parts = parts4(2500, 1200, 0, 3);
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|p| p.0 <= MOST && p.1 <= MOST));
        assert_eq!(parts.iter().map(|p| p.0).sum::<u64>(), 2500);
        assert_eq!(parts.iter().map(|p| p.1).sum::<u64>(), 1200);
        assert_eq!(parts.iter().map(|p| p.3).sum::<u64>(), 3);
        assert!(parts4(0, 0, 0, 0).is_empty());
    }

    /// The events' whole text for a week, as the shell would send it.
    fn written(dir: &Path, counter: &Counter, current: &str) -> (usize, String) {
        use crate::diagnostics::registry;
        use tauri_kit_diagnostics::{InstallId, Screens, Session};
        let install = InstallId::load_or_create(&dir.join("install-id")).unwrap();
        let session = Session::builder(&install, "0.0.0").screens(Screens::new(["welcome"])).start(dir.join("s.jsonl"), dir.join("running")).unwrap();
        let events = Events::open(&session, registry().clone(), dir.join("events.jsonl")).unwrap().max_per_event(1000);
        let flushed = counter.flush(current, &events, registry()).unwrap();
        (flushed, std::fs::read_to_string(dir.join("events.jsonl")).unwrap_or_default())
    }

    #[test]
    fn an_ended_week_is_written_as_declared_events_and_forgotten_but_the_current_one_waits() {
        let dir = tempfile::tempdir().unwrap();
        let counter = counter(dir.path());
        counter.add("2026-10-05", &[used("session.topic", true, Decision::Accepted, true, Some(1500)), used("session.topic", true, Decision::Corrected, true, Some(300))]).unwrap();
        counter.add("2026-10-12", &[used("session.topic", true, Decision::Accepted, false, Some(900))]).unwrap();
        let (flushed, text) = written(dir.path(), &counter, "2026-10-12");
        assert_eq!(flushed, 1);
        let lines: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let names: Vec<&str> = lines.iter().map(|l| l["name"].as_str().unwrap()).collect();
        let count = |name: &str| names.iter().filter(|n| **n == name).count();
        assert_eq!((count("suggestion.use"), count("suggestion.trust"), count("suggestion.dwell")), (1, 1, 2), "{text}");
        assert_eq!(names.len(), 4, "nothing else, and nothing dropped: {text}");
        // Nothing in a line names the installation or the launch: an event has an identifier of its own.
        let install = std::fs::read_to_string(dir.path().join("install-id")).unwrap();
        assert!(!text.contains(install.trim()), "the installation number is in {text}");
        let weeks = counter.load();
        assert!(!weeks.contains_key("2026-10-05"), "what was written is forgotten");
        assert!(weeks.contains_key("2026-10-12"), "the running week waits for its end");
        // Written once: a second flush finds nothing more to write.
        let (again, _) = written(dir.path(), &counter, "2026-10-12");
        assert_eq!(again, 0);
    }
}
