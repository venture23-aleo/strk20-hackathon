/**
 * Emits contracts/tests/vectors_gen.cairo from the frozen vectors/derivations.json,
 * so the Cairo tests consume the exact same interface vectors as the TS tests.
 * Run after any (deliberate, reviewed) vector regeneration: node vectors/to-cairo.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(readFileSync(join(here, "derivations.json"), "utf8"));

const s = v.sealed[0];
const s2 = v.sealed[1];
const feltArray = (felts) => felts.join(",\n        ");

const out = `//! AUTO-GENERATED from vectors/derivations.json — do not edit.
//! Regenerate: node vectors/to-cairo.mjs
//! Source: ${v._meta.source}

/// sealed[0]: "${s.label}" — msg_id and packed ciphertext felts.
pub fn sealed_0() -> (felt252, Span<felt252>) {
    (
        ${s.msg_id},
        array![
        ${feltArray(s.felts)}
        ]
            .span(),
    )
}

/// sealed[1]: "${s2.label}".
pub fn sealed_1() -> (felt252, Span<felt252>) {
    (
        ${s2.msg_id},
        array![
        ${feltArray(s2.felts)}
        ]
            .span(),
    )
}
`;
writeFileSync(join(here, "../contracts/tests/vectors_gen.cairo"), out);
console.log("wrote contracts/tests/vectors_gen.cairo");
