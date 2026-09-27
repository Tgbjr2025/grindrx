//! Nesting-depth guard for inbound msgpack payloads.
//!
//! A byte-length cap does **not** bound nesting. msgpack encodes a 1-element
//! array in a single byte (`0x91`), a 1-element map in a single byte (`0x81`),
//! and an empty string in a single byte (`0xa0`). So an 8 MB body — comfortably
//! under `MAX_REQUEST_PAYLOAD_BYTES` — can encode roughly **eight million levels
//! of nesting**.
//!
//! `rmp_serde` enforces no recursion limit of its own, so decoding that
//! overflows the stack. That matters more than a normal decode failure: a Rust
//! stack overflow **aborts the process**. It is not an `Err`, so it cannot be
//! caught, cannot be turned into an `ApiHttpError`, and takes the whole app down
//! rather than failing one request.
//!
//! This walks the msgpack structure and rejects anything nested deeper than
//! [`MAX_DEPTH`] *before* the bytes reach `rmp_serde`.
//!
//! Note this counts **nesting depth**, not element count. An earlier attempt at
//! this guard counted total containers and would have rejected any legitimate
//! payload with more than 64 elements *at one level* — a real profile or
//! conversation response has far more than that — so it was removed rather than
//! shipped. Depth is the quantity that actually maps to stack usage.
//!
//! The walker recurses, but it checks the limit **before** descending, so its
//! own recursion is bounded by `MAX_DEPTH + 1` frames. It cannot be the thing
//! that overflows the stack.

/// Maximum container nesting depth accepted. Real API responses are shallow —
/// the deepest thing the app receives is a few levels of JSON-ish objects and
/// arrays — so 64 is generous while still far below the ~1000s of frames that
/// threaten the default 8 MB main-thread stack.
pub const MAX_DEPTH: usize = 64;

type CheckResult = Result<(), String>;

/// Reject `bytes` if its msgpack structure nests deeper than `max`.
///
/// Walks exactly one top-level value; trailing bytes are not examined (the
/// caller's decoder will reject those itself).
pub fn check_depth(bytes: &[u8], max: usize) -> CheckResult {
    let mut pos = 0usize;
    value(bytes, &mut pos, 0, max)?;
    Ok(())
}

/// Advance the cursor past `n` payload bytes, erroring if that would run off
/// the end of the buffer. `checked_add` because `n` comes from the payload.
fn skip(bytes: &[u8], pos: &mut usize, n: usize) -> CheckResult {
    let end = pos.checked_add(n).ok_or("msgpack length overflows usize")?;
    if end > bytes.len() {
        return Err("msgpack payload truncated".to_string());
    }
    *pos = end;
    Ok(())
}

fn read_u8(bytes: &[u8], pos: &mut usize) -> Result<u8, String> {
    let b = *bytes
        .get(*pos)
        .ok_or_else(|| "msgpack payload truncated".to_string())?;
    *pos += 1;
    Ok(b)
}

fn read_u16(bytes: &[u8], pos: &mut usize) -> Result<usize, String> {
    let mut buf = [0u8; 2];
    for slot in buf.iter_mut() {
        *slot = read_u8(bytes, pos)?;
    }
    Ok(u16::from_be_bytes(buf) as usize)
}

fn read_u32(bytes: &[u8], pos: &mut usize) -> Result<usize, String> {
    let mut buf = [0u8; 4];
    for slot in buf.iter_mut() {
        *slot = read_u8(bytes, pos)?;
    }
    Ok(u32::from_be_bytes(buf) as usize)
}

/// Read a length prefix of `width` bytes (1, 2 or 4).
fn read_len(bytes: &[u8], pos: &mut usize, width: u8) -> Result<usize, String> {
    match width {
        1 => Ok(read_u8(bytes, pos)? as usize),
        2 => read_u16(bytes, pos),
        _ => read_u32(bytes, pos),
    }
}

/// An array: `count` elements, each one level deeper.
fn array(bytes: &[u8], pos: &mut usize, count: usize, depth: usize, max: usize) -> CheckResult {
    if depth + 1 > max {
        return Err(depth_err(depth + 1, max));
    }
    for _ in 0..count {
        value(bytes, pos, depth + 1, max)?;
    }
    Ok(())
}

/// A map: `count` entries of key + value, **both** one level deeper. The key is
/// walked too — msgpack permits a container as a map key, and a key that nests
/// is just as capable of overflowing the stack as a value.
fn map(bytes: &[u8], pos: &mut usize, count: usize, depth: usize, max: usize) -> CheckResult {
    if depth + 1 > max {
        return Err(depth_err(depth + 1, max));
    }
    for _ in 0..count {
        value(bytes, pos, depth + 1, max)?;
        value(bytes, pos, depth + 1, max)?;
    }
    Ok(())
}

fn depth_err(found: usize, max: usize) -> String {
    format!("msgpack nesting depth {found} exceeds maximum {max}")
}

/// Walk one value starting at `*pos`, advancing the cursor past it.
fn value(bytes: &[u8], pos: &mut usize, depth: usize, max: usize) -> CheckResult {
    let b = read_u8(bytes, pos)?;
    match b {
        // positive fixint / negative fixint — single byte, no payload
        0x00..=0x7f | 0xe0..=0xff => {}
        // nil / false / true
        0xc0 | 0xc2 | 0xc3 => {}
        // 0xc1 is explicitly "never used" in the msgpack spec
        0xc1 => return Err("msgpack byte 0xc1 is never valid".to_string()),

        0x80..=0x8f => map(bytes, pos, (b & 0x0f) as usize, depth, max)?,
        0x90..=0x9f => array(bytes, pos, (b & 0x0f) as usize, depth, max)?,
        // fixstr — a scalar: skipped, not descended into
        0xa0..=0xbf => skip(bytes, pos, (b & 0x1f) as usize)?,

        // fixed-width scalars
        0xcc | 0xd0 => skip(bytes, pos, 1)?, // uint8, int8
        0xcd | 0xd1 => skip(bytes, pos, 2)?, // uint16, int16
        0xce | 0xd2 | 0xca => skip(bytes, pos, 4)?, // uint32, int32, float32
        0xcf | 0xd3 | 0xcb => skip(bytes, pos, 8)?, // uint64, int64, float64

        // str8/16/32 and bin8/16/32 — all scalars with a length prefix
        0xc4 | 0xd9 => {
            let n = read_len(bytes, pos, 1)?;
            skip(bytes, pos, n)?;
        }
        0xc5 | 0xda => {
            let n = read_len(bytes, pos, 2)?;
            skip(bytes, pos, n)?;
        }
        0xc6 | 0xdb => {
            let n = read_len(bytes, pos, 4)?;
            skip(bytes, pos, n)?;
        }

        // fixext1/2/4/8/16 — 1 type byte then 1/2/4/8/16 data bytes, all scalar
        0xd4..=0xd8 => {
            let n = 1usize << (b - 0xd4);
            skip(bytes, pos, 1)?; // type
            skip(bytes, pos, n)?; // data
        }
        // ext8/16/32 — 1 type byte then a length-prefixed payload
        0xc7 => {
            let n = read_len(bytes, pos, 1)?;
            skip(bytes, pos, 1)?;
            skip(bytes, pos, n)?;
        }
        0xc8 => {
            let n = read_len(bytes, pos, 2)?;
            skip(bytes, pos, 1)?;
            skip(bytes, pos, n)?;
        }
        0xc9 => {
            let n = read_len(bytes, pos, 4)?;
            skip(bytes, pos, 1)?;
            skip(bytes, pos, n)?;
        }

        0xdc => {
            let n = read_len(bytes, pos, 2)?;
            array(bytes, pos, n, depth, max)?;
        }
        0xdd => {
            let n = read_len(bytes, pos, 4)?;
            array(bytes, pos, n, depth, max)?;
        }
        0xde => {
            let n = read_len(bytes, pos, 2)?;
            map(bytes, pos, n, depth, max)?;
        }
        0xdf => {
            let n = read_len(bytes, pos, 4)?;
            map(bytes, pos, n, depth, max)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmp_serde::to_vec_named;

    /// Convenience: run the guard and report only pass/fail.
    fn ok(bytes: &[u8]) -> bool {
        check_depth(bytes, MAX_DEPTH).is_ok()
    }

    #[test]
    fn accepts_real_encoded_values() {
        // Fixtures produced by rmp_serde itself, not hand-rolled bytes, so these
        // are known-valid msgpack rather than something that merely looks right.
        for value in [
            serde_json::json!(null),
            serde_json::json!(true),
            serde_json::json!(-1),
            serde_json::json!(u64::MAX),
            serde_json::json!(1.5),
            serde_json::json!(""),
            serde_json::json!("hello"),
            serde_json::json!({}),
            serde_json::json!([]),
            serde_json::json!({"a": 1, "b": [1, 2, 3]}),
            serde_json::json!([{"id": 1}, {"id": 2}]),
        ] {
            let bytes = to_vec_named(&value).expect("encode");
            assert!(
                check_depth(&bytes, MAX_DEPTH).is_ok(),
                "rejected a valid real-world value: {value}"
            );
        }
    }

    #[test]
    fn accepts_a_wide_but_shallow_payload() {
        // The regression that killed the first attempt: 500 sibling elements at
        // ONE level is depth 1, and must be accepted. A guard that counted
        // containers rather than depth would reject this.
        let items: Vec<i32> = (0..500).collect();
        let bytes = to_vec_named(&items).expect("encode");
        assert!(ok(&bytes), "500 siblings is shallow, not deep");
    }

    #[test]
    fn accepts_nesting_just_inside_the_limit() {
        for depth in 1..=MAX_DEPTH {
            let bytes = nest(depth);
            assert!(
                check_depth(&bytes, MAX_DEPTH).is_ok(),
                "depth {depth} should be accepted"
            );
        }
    }

    #[test]
    fn rejects_nesting_past_the_limit() {
        for depth in [MAX_DEPTH + 1, MAX_DEPTH + 2, 1000] {
            let bytes = nest(depth);
            let err = check_depth(&bytes, MAX_DEPTH).expect_err("should reject");
            assert!(err.contains("nesting depth"), "unexpected error: {err}");
        }
    }

    /// `depth` nested single-element arrays, e.g. `[[[...]]]`. Each level is one
    /// byte (`0x91`), so this is also the realistic shape of the attack: a tiny
    /// payload that is enormously deep.
    fn nest(depth: usize) -> Vec<u8> {
        let mut bytes = vec![0x91u8; depth];
        bytes.push(0xc0); // nil at the bottom
        bytes
    }

    #[test]
    fn one_million_levels_is_rejected_and_never_recurses_too_deep() {
        // 1 MB, ~1,000,000 levels — well under MAX_REQUEST_PAYLOAD_BYTES, which
        // is the whole point. Must be rejected quickly and without recursing.
        let bytes = nest(1_000_000);
        assert_eq!(bytes.len(), 1_000_001);
        let err = check_depth(&bytes, MAX_DEPTH).expect_err("should reject");
        assert!(err.contains(&format!("exceeds maximum {MAX_DEPTH}")), "{err}");
    }

    #[test]
    fn rejects_deep_nesting_inside_a_map() {
        // {a: {a: {a: ... }}} — the shape an object-shaped payload takes.
        let mut bytes = Vec::new();
        for _ in 0..(MAX_DEPTH + 10) {
            bytes.extend_from_slice(&[0x81, 0xa1]); // fixmap(1), fixstr(1)
            bytes.push(b'k');
        }
        bytes.push(0xc0);
        assert!(check_depth(&bytes, MAX_DEPTH).is_err());
    }

    #[test]
    fn rejects_a_deep_container_used_as_a_map_key() {
        // Map KEYS are walked too. A key that is itself a deep container is just
        // as capable of overflowing the decoder's stack as a value.
        let mut bytes = vec![0x81]; // fixmap(1)
        bytes.extend_from_slice(&nest(MAX_DEPTH + 5)); // the key
        bytes.push(0xc0); // the value
        assert!(check_depth(&bytes, MAX_DEPTH).is_err());
    }

    #[test]
    fn counts_a_map_entry_as_one_level_not_two() {
        // {"a": {"b": 1}} is depth 2: the outer map is level 1, the inner map is
        // level 2. Its key and value are both AT level 2, not level 3.
        let bytes = to_vec_named(&serde_json::json!({"a": {"b": 1}})).expect("encode");
        assert!(ok(&bytes));

        let mut probe = bytes.clone();
        // Wrapping in 62 more levels puts the innermost map at exactly 64.
        let mut wrapped = vec![0x91u8; 62];
        wrapped.extend_from_slice(&probe);
        assert!(ok(&wrapped), "62 + 2 should be exactly at the limit");
        probe.clear();
        let mut too_deep = vec![0x91u8; 63];
        too_deep.extend_from_slice(&bytes);
        assert!(check_depth(&too_deep, MAX_DEPTH).is_err());
    }

    #[test]
    fn accepts_every_array_and_map_header_width() {
        // array16/map16/array32/map32 use multi-byte length headers; a guard that
        // mis-reads those would either mis-count depth or desync the cursor and
        // then reject valid data.
        assert!(ok(&[0xdc, 0x00, 0x00])); // array16, 0 elements
        assert!(ok(&[0xdd, 0x00, 0x00, 0x00, 0x00])); // array32, 0 elements
        assert!(ok(&[0xde, 0x00, 0x00])); // map16, 0 entries
        assert!(ok(&[0xdf, 0x00, 0x00, 0x00, 0x00])); // map32, 0 entries
        // array32 holding 3 nil values
        assert!(ok(&[0xdd, 0x00, 0x00, 0x00, 0x03, 0xc0, 0xc0, 0xc0]));
        // deeply nested via the 16-bit header
        let mut deep = vec![0xdc, 0x00, 0x01, 0x91];
        deep.extend_from_slice(&nest(MAX_DEPTH));
        assert!(check_depth(&deep, MAX_DEPTH).is_err());
    }

    #[test]
    fn accepts_every_scalar_and_ext_width() {
        // Scalars carry payloads that must be SKIPPED, not descended into. If a
        // width were mis-read the cursor would desync and the guard would either
        // reject valid data or walk into the middle of a string.
        let cases: Vec<Vec<u8>> = vec![
            vec![0xca, 0, 0, 0, 0],                   // float32
            vec![0xcb, 0, 0, 0, 0, 0, 0, 0, 0],       // float64
            vec![0xcc, 0],                             // uint8
            vec![0xcd, 0, 0],                         // uint16
            vec![0xce, 0, 0, 0, 0],                   // uint32
            vec![0xcf, 0, 0, 0, 0, 0, 0, 0, 0],       // uint64
            vec![0xd0, 0],                             // int8
            vec![0xd1, 0, 0],                         // int16
            vec![0xd2, 0, 0, 0, 0],                   // int32
            vec![0xd3, 0, 0, 0, 0, 0, 0, 0, 0],       // int64
            vec![0xc4, 2, 0x91, 0x91],                // bin8, 2 bytes of nested-looking data
            vec![0xc5, 0, 2, 0x91, 0x91],             // bin16
            vec![0xc6, 0, 0, 0, 2, 0x91, 0x91],       // bin32
            vec![0xd9, 2, 0x91, 0x91],                // str8
            vec![0xda, 0, 2, 0x91, 0x91],             // str16
            vec![0xdb, 0, 0, 0, 2, 0x91, 0x91],       // str32
            vec![0xd4, 7, 0x91],                      // fixext1: type + 1 data byte
            vec![0xd5, 7, 0x91, 0x91],                // fixext2
            vec![0xd6, 7, 0, 0, 0, 0],                // fixext4
            vec![0xd7, 7, 0, 0, 0, 0, 0, 0, 0, 0],    // fixext8
            vec![0xd8, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // fixext16
            vec![0xc7, 1, 7, 0x91],                   // ext8: len 1, type, data
            vec![0xc8, 0, 1, 7, 0x91],                // ext16
            vec![0xc9, 0, 0, 0, 1, 7, 0x91],          // ext32
            vec![0xa3, b'a', b'b', b'c'],             // fixstr(3)
        ];
        for case in cases {
            assert!(ok(&case), "rejected a valid scalar: {case:02x?}");
        }
    }

    #[test]
    fn rejects_the_never_used_byte() {
        assert!(check_depth(&[0xc1], MAX_DEPTH).is_err());
    }

    #[test]
    fn rejects_truncated_payloads_instead_of_panicking() {
        // A hostile payload can claim a length it does not have. Every one of
        // these must be an Err, never a panic and never a silent accept.
        let cases: Vec<Vec<u8>> = vec![
            vec![0xa1],                   // fixstr(1) with no data
            vec![0xa5, b'a'],             // fixstr(5) with 1 byte
            vec![0xcd, 0],                // uint16 missing a byte
            vec![0xce, 0, 0],             // uint32 missing bytes
            vec![0xdc, 0x00],             // array16 missing its length
            vec![0x91],                   // array(1) with no element
            vec![0x81],                   // map(1) with no key or value
            vec![0x81, 0xa1, b'k'],       // map key present, value missing
            vec![0x92, 0xc0],             // array(2) with one element
            vec![0xc4],                   // bin8 missing its length
            vec![0xc4, 5, 1, 2],          // bin8 claiming 5 bytes, 2 present
            vec![],                       // empty
        ];
        for case in cases {
            assert!(
                check_depth(&case, MAX_DEPTH).is_err(),
                "truncated payload was accepted: {case:02x?}"
            );
        }
    }

    #[test]
    fn a_huge_claimed_length_does_not_overflow() {
        // bin32 claiming 4 GB in a 4-byte buffer. Must be a clean Err, not a
        // wrapping `pos + n` that walks off the start of the buffer.
        let mut bytes = vec![0xc6];
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(check_depth(&bytes, MAX_DEPTH).is_err());

        // And the same via array32, where a wrapping count could otherwise loop
        // nearly forever instead of erroring.
        let mut arr = vec![0xdd];
        arr.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(check_depth(&arr, MAX_DEPTH).is_err());
    }

    #[test]
    fn guard_agrees_with_rmp_serde_on_what_decodes() {
        // Cross-check: everything rmp_serde accepts, the guard must not reject
        // for depth. (The guard can still reject a truncated payload, but not a
        // genuinely decodable one.)
        let values = vec![
            serde_json::json!([]),
            serde_json::json!({}),
            serde_json::json!([1, [2, [3, [4]]]]),
            serde_json::json!({"a": {"b": {"c": [1, 2, 3]}}}),
            serde_json::json!([[[[[[[[[[1]]]]]]]]]]),
        ];
        for v in values {
            let bytes = to_vec_named(&v).expect("encode");
            let decoded: Result<serde_json::Value, _> = rmp_serde::from_slice(&bytes);
            assert!(decoded.is_ok(), "fixture failed to decode: {v}");
            assert!(ok(&bytes), "guard rejected a decodable payload: {v}");
        }
    }
}
