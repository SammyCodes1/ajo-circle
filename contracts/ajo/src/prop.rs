//! Property tests (build brief §3.2): seeded random circles run against the
//! contract and against a plain-Rust port of the reference model
//! (`model/model3.py` / `scenarios.py`). Case count: `PROPTEST_CASES`;
//! if unset, 10_000 in optimised builds (`cargo test --release`) and 256 in
//! debug builds so a plain `cargo test` stays fast. Every property prints
//! `cases=N`. Gate: `PROPTEST_CASES=10000 cargo test --release -p ajo prop_`.
#![cfg(test)]
// Index loops keep the model port line-by-line comparable with the Python.
#![allow(clippy::needless_range_loop, clippy::manual_memcpy)]
extern crate std;

use crate::test::{check_invariants, claim_all, setup, Setup};
use crate::{CircleStatus, Error};
use soroban_sdk::testutils::Ledger;
use std::{println, vec, vec::Vec};

const PERIOD: u64 = 3_600;
const JOIN: u64 = 86_400;
const CS: [i128; 5] = [1, 3, 7, 10_000_000, 12_345_671];

fn cases() -> u64 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(if cfg!(debug_assertions) { 256 } else { 10_000 })
}

/// xorshift64* — small, seeded, deterministic.
pub(crate) struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03 | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn coin(&mut self) -> bool {
        self.next() & 1 == 1
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Case {
    pub n: usize,
    pub c: i128,
    pub honest: Vec<bool>,
    /// pays[m][r]
    pub pays: Vec<Vec<bool>>,
    pub posts: Vec<i128>,
}

fn r_k(n: usize, c: i128, k: usize) -> i128 {
    c * (n - 1 - k) as i128
}

pub(crate) fn gen(rng: &mut Rng) -> Case {
    let n = 2 + rng.below(7) as usize; // 2..=8
    let c = CS[rng.below(CS.len() as u64) as usize];
    let mut honest = vec![false; n];
    let mut pays = vec![vec![false; n]; n];
    let mut posts = vec![0i128; n];
    for m in 0..n {
        posts[m] = if rng.coin() { r_k(n, c, m) } else { 0 };
        if rng.unit() < 0.4 {
            honest[m] = true;
            pays[m] = vec![true; n];
            continue;
        }
        // force-include archetypes for ~30% of the non-honest members
        if rng.unit() < 0.3 {
            match rng.below(3) {
                // walk-away: pays until it has received, then never
                0 => (0..n).for_each(|r| pays[m][r] = r <= m),
                // never pays
                1 => {}
                // pays only its own round
                _ => pays[m][m] = true,
            }
            continue;
        }
        let p = rng.unit();
        for r in 0..n {
            pays[m][r] = rng.unit() < p;
        }
    }
    Case {
        n,
        c,
        honest,
        pays,
        posts,
    }
}

// ------------------------------------------------- reference model (model3)

/// Plain-Rust port of `model/scenarios.py::run` (model3 rules).
/// Returns (nets, claimable-at-end-before-claims).
pub(crate) fn model_run(
    n: usize,
    c: i128,
    pays: &[Vec<bool>],
    posts: &[i128],
) -> (Vec<i128>, Vec<i128>) {
    struct M {
        n: usize,
        c: i128,
        coll: Vec<i128>,
        claim: Vec<i128>,
        received: Vec<bool>,
        rnd: usize,
        owed: Vec<(usize, usize, i128)>, // (debtor, creditor, amount), creation order
    }
    impl M {
        fn need(&self, m: usize) -> i128 {
            if self.received[m] {
                self.c * (self.n - 1).saturating_sub(self.rnd) as i128
            } else {
                0
            }
        }
        fn credit(&mut self, m: usize, mut amt: i128) {
            for i in 0..self.owed.len() {
                let (d, cr, a) = self.owed[i];
                if d == m && a > 0 && amt > 0 {
                    let p = amt.min(a);
                    self.owed[i].2 -= p;
                    amt -= p;
                    self.credit(cr, p);
                }
            }
            let w = amt.min((self.need(m) - self.coll[m]).max(0));
            self.coll[m] += w;
            amt -= w;
            self.claim[m] += amt;
        }
    }
    let mut bal = vec![0i128; n];
    let mut s = M {
        n,
        c,
        coll: vec![0; n],
        claim: vec![0; n],
        received: vec![false; n],
        rnd: 0,
        owed: Vec::new(),
    };
    for i in 0..n {
        s.coll[i] = posts[i];
        bal[i] -= posts[i];
    }
    for r in 0..n {
        s.rnd = r;
        let mut pot = 0;
        for m in 0..n {
            if pays[m][r] {
                bal[m] -= c;
                pot += c;
                continue;
            }
            if m == r {
                continue;
            }
            let t = c.min(s.coll[m]);
            s.coll[m] -= t;
            pot += t;
            if c - t > 0 {
                s.owed.push((m, r, c - t));
            }
        }
        s.received[r] = true;
        s.credit(r, pot);
        for m in 0..n {
            let open = s.owed.iter().any(|d| d.0 == m && d.2 > 0);
            if s.received[m] && !open {
                let ex = s.coll[m] - s.need(m);
                if ex > 0 {
                    s.coll[m] -= ex;
                    s.claim[m] += ex;
                }
            }
        }
    }
    for i in 0..n {
        s.claim[i] += s.coll[i];
        s.coll[i] = 0;
    }
    let claimable = s.claim.clone();
    for i in 0..n {
        bal[i] += s.claim[i];
    }
    (bal, claimable)
}

// ------------------------------------------------------- contract runner

pub(crate) struct Outcome {
    pub nets: Vec<i128>,
    pub credit_loop: bool,
    pub balance_after: i128,
    pub in_eq_claimed: bool,
}

pub(crate) fn new_circle(case: &Case) -> (Setup<'static>, u32) {
    let n = case.n;
    let start = case.c * n as i128 + r_k(n, case.c, 0) + 1;
    let s = setup(n as u32, start);
    s.env.cost_estimate().budget().reset_unlimited();
    let id = s
        .client
        .create_circle(&s.admin, &case.c, &s.members, &PERIOD, &JOIN);
    for (i, p) in case.posts.iter().enumerate() {
        s.client.accept(&id, &s.members.get(i as u32).unwrap(), p);
    }
    (s, id)
}

/// I1/I2/I3/I4 plus "every collateral, open debt and pot is a multiple of c".
pub(crate) fn check_all(s: &Setup, id: u32) {
    check_invariants(s, &[id]);
    let circle = s.client.get_circle(&id);
    let c = circle.contribution;
    assert_eq!(circle.pot % c, 0, "pot multiple of c");
    for m in circle.members.iter() {
        let st = s.client.get_member_state(&id, &m);
        assert_eq!(st.collateral % c, 0, "collateral multiple of c");
        for d in st.debts.iter() {
            assert_eq!(d.amount % c, 0, "debt multiple of c");
        }
    }
}

/// Plays every contribution of round `r` (with optional per-call checks).
pub(crate) fn contribute_round(s: &Setup, id: u32, case: &Case, r: usize, check: bool) {
    for m in 0..case.n {
        if case.pays[m][r] {
            s.client.contribute(&id, &s.members.get(m as u32).unwrap());
            if check {
                check_all(s, id);
            }
        }
    }
}

pub(crate) fn run_contract(case: &Case, rng: &mut Rng, check: bool) -> Outcome {
    let (s, id) = new_circle(case);
    if check {
        check_all(&s, id);
    }
    let mut credit_loop = false;
    for r in 0..case.n {
        contribute_round(&s, id, case, r, check);
        if (0..case.n).any(|m| !case.pays[m][r]) {
            let dl = s.client.get_circle(&id).round_start + PERIOD;
            s.env.ledger().set_timestamp(dl);
        }
        match s.client.try_settle(&id) {
            Ok(_) => {}
            Err(Ok(Error::CreditLoop)) => {
                credit_loop = true;
                break;
            }
            Err(e) => panic!("settle failed: {:?}", e),
        }
        if check {
            check_all(&s, id);
        }
        // random claims between rounds must not change nets
        for m in s.members.iter() {
            if rng.below(3) == 0 && s.client.get_member_state(&id, &m).claimable > 0 {
                s.client.claim(&id, &m);
                if check {
                    check_all(&s, id);
                }
            }
        }
    }
    if !credit_loop {
        assert_eq!(s.client.get_circle(&id).status, CircleStatus::Completed);
    }
    claim_all(&s, id);
    let mut tin = 0;
    let mut tclaimed = 0;
    for m in s.members.iter() {
        let st = s.client.get_member_state(&id, &m);
        tin += st.total_in;
        tclaimed += st.total_claimed;
    }
    Outcome {
        nets: s
            .members
            .iter()
            .map(|m| s.token.balance(&m) - s.start)
            .collect(),
        credit_loop,
        balance_after: s.token.balance(&s.contract),
        in_eq_claimed: tin == tclaimed,
    }
}

fn for_cases(name: &str, mut f: impl FnMut(u64, &Case, &mut Rng)) {
    let n = cases();
    for seed in 0..n {
        let mut rng = Rng::new(seed);
        let case = gen(&mut rng);
        f(seed, &case, &mut rng);
    }
    println!("{name}: cases={n}");
}

#[test]
fn prop_honest_never_negative() {
    let mut zero = 0u64;
    let mut honest = 0u64;
    for_cases("prop_honest_never_negative", |seed, case, rng| {
        let out = run_contract(case, rng, false);
        for m in 0..case.n {
            if case.honest[m] {
                honest += 1;
                assert!(
                    out.nets[m] >= 0,
                    "seed {seed}: honest member {m} net {}",
                    out.nets[m]
                );
                if out.nets[m] == 0 {
                    zero += 1;
                }
            }
        }
    });
    println!("  honest members checked={honest}, net exactly 0: {zero}");
}

#[test]
fn prop_conservation() {
    for_cases("prop_conservation", |seed, case, rng| {
        let out = run_contract(case, rng, true);
        assert_eq!(out.balance_after, 0, "seed {seed}: contract not empty");
        assert!(out.in_eq_claimed, "seed {seed}: total_in != total_claimed");
        assert_eq!(out.nets.iter().sum::<i128>(), 0, "seed {seed}: nets sum");
    });
}

#[test]
fn prop_matches_model() {
    for_cases("prop_matches_model", |seed, case, rng| {
        let out = run_contract(case, rng, false);
        let (model, _) = model_run(case.n, case.c, &case.pays, &case.posts);
        assert_eq!(
            out.nets, model,
            "seed {seed}: contract != model for {case:?}"
        );
    });
}

#[test]
fn prop_no_credit_loop() {
    for_cases("prop_no_credit_loop", |seed, case, rng| {
        let out = run_contract(case, rng, false);
        assert!(!out.credit_loop, "seed {seed}: CreditLoop");
    });
}

#[test]
fn prop_amounts_multiple_of_c() {
    // run_contract(check = true) asserts the multiple-of-c rule after every call
    for_cases("prop_amounts_multiple_of_c", |_, case, rng| {
        run_contract(case, rng, true);
    });
}

#[test]
fn model_port_matches_scenarios() {
    // spot-check the Rust model port against scenarios.py outputs
    let t = |v: &[bool]| v.to_vec();
    let (tt, ff) = (true, false);
    // S2b walk-away, nobody posts: nets 0/0/0
    let pays = vec![t(&[tt, ff, ff]), t(&[tt, tt, tt]), t(&[tt, tt, tt])];
    assert_eq!(model_run(3, 10, &pays, &[0, 0, 0]).0, vec![0, 0, 0]);
    // S4 C never pays, posts [20,10,0]
    let pays = vec![t(&[tt, tt, tt]), t(&[tt, tt, tt]), t(&[ff, ff, ff])];
    assert_eq!(model_run(3, 10, &pays, &[20, 10, 0]).0, vec![0, 0, 0]);
}

#[test]
fn prop_unwind_conserves() {
    for_cases("prop_unwind_conserves", |seed, case, rng| {
        let (s, id) = new_circle(case);
        let stop = rng.below(case.n as u64) as usize;
        for r in 0..case.n {
            contribute_round(&s, id, case, r, false);
            if r == stop {
                break;
            }
            if (0..case.n).any(|m| !case.pays[m][r]) {
                let dl = s.client.get_circle(&id).round_start + PERIOD;
                s.env.ledger().set_timestamp(dl);
            }
            s.client.settle(&id);
        }
        check_all(&s, id);
        let circle = s.client.get_circle(&id);
        let grace = circle.round_start + PERIOD * (1 + crate::UNWIND_GRACE_PERIODS);
        s.env.ledger().set_timestamp(grace);
        let mut h = circle.pot;
        let mut before = 0i128;
        let mut d_total = 0i128;
        for m in s.members.iter() {
            let st = s.client.get_member_state(&id, &m);
            h += st.collateral;
            before += st.claimable;
            d_total += (st.total_in - st.total_credited).max(0);
        }
        // the D == 0 fallback (all to slot 0) is unreachable when H > 0
        assert!(h == 0 || d_total > 0, "seed {seed}: H > 0 with D == 0");
        s.client.unwind(&id);
        check_invariants(&s, &[id]);
        let after: i128 = s
            .members
            .iter()
            .map(|m| s.client.get_member_state(&id, &m).claimable)
            .sum();
        assert_eq!(after - before, h, "seed {seed}: shares != H");
        claim_all(&s, id);
        assert_eq!(s.token.balance(&s.contract), 0, "seed {seed}");
        for m in 0..case.n {
            let net = s.token.balance(&s.members.get(m as u32).unwrap()) - s.start;
            if case.honest[m] {
                assert!(
                    net >= 0,
                    "seed {seed}: honest {m} net {net} after unwind at {stop}"
                );
            }
        }
    });
}
