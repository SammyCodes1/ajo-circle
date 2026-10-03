#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, AuthorizedFunction, AuthorizedInvocation, EnvTestConfig, Events as _,
        IssuerFlags, Ledger, StellarAssetIssuer,
    },
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Event as _, IntoVal, Symbol,
};

/// 10 USDC (7 decimals).
const C: i128 = 100_000_000;
const PERIOD: u64 = 3_600;
const JOIN: u64 = 86_400;
const T0: u64 = 1_000_000;

pub(crate) struct Setup<'a> {
    pub env: Env,
    pub client: AjoContractClient<'a>,
    pub token: TokenClient<'a>,
    pub sac_admin: StellarAssetClient<'a>,
    pub issuer: StellarAssetIssuer,
    pub admin: Address,
    pub members: Vec<Address>,
    pub contract: Address,
    pub start: i128,
}

pub(crate) fn setup(n: u32, start_balance: i128) -> Setup<'static> {
    // No JSON snapshot per Env: property tests create tens of thousands.
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = TokenClient::new(&env, &sac.address());
    let sac_admin = StellarAssetClient::new(&env, &sac.address());
    let issuer = sac.issuer();

    let mut members = Vec::new(&env);
    for _ in 0..n {
        let m = Address::generate(&env);
        sac_admin.mint(&m, &start_balance);
        members.push_back(m);
    }

    let contract = env.register(AjoContract, (sac.address(),));
    let client = AjoContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    Setup {
        env,
        client,
        token,
        sac_admin,
        issuer,
        admin,
        members,
        contract,
        start: start_balance,
    }
}

/// Default setup: enough balance for every contribution plus R_0.
fn setup_n(n: u32) -> Setup<'static> {
    setup(n, C * i128::from(2 * n))
}

fn mem(s: &Setup, i: u32) -> Address {
    s.members.get(i).unwrap()
}

fn create(s: &Setup) -> u32 {
    s.client
        .create_circle(&s.admin, &C, &s.members, &PERIOD, &JOIN)
}

/// Create a circle and have every member accept with `posts[i]` collateral.
fn start(s: &Setup, posts: &[i128]) -> u32 {
    let id = create(s);
    for (i, p) in posts.iter().enumerate() {
        s.client.accept(&id, &mem(s, i as u32), p);
    }
    id
}

fn state(s: &Setup, id: u32, i: u32) -> MemberState {
    s.client.get_member_state(&id, &mem(s, i))
}

fn set_time(s: &Setup, t: u64) {
    s.env.ledger().set_timestamp(t);
}

fn states(s: &Setup, id: u32) -> std::vec::Vec<MemberState> {
    let circle = s.client.get_circle(&id);
    circle
        .members
        .iter()
        .map(|m| s.client.get_member_state(&id, &m))
        .collect()
}

/// I1-I3 (and I4 once settle releases collateral). Call after every
/// contract call.
pub(crate) fn check_invariants(s: &Setup, ids: &[u32]) {
    let mut held_total = 0i128;
    for &id in ids {
        let circle = s.client.get_circle(&id);
        let sts = states(s, id);
        let sum = |f: &dyn Fn(&MemberState) -> i128| sts.iter().map(f).sum::<i128>();
        let coll = sum(&|m| m.collateral);
        let claimable = sum(&|m| m.claimable);
        held_total += circle.pot + coll + claimable;
        // I2 conservation (per circle)
        assert_eq!(
            sum(&|m| m.total_in),
            sum(&|m| m.total_credited) + circle.pot + coll,
            "I2: total_in == credited + pot + collateral"
        );
        assert_eq!(
            sum(&|m| m.total_credited),
            sum(&|m| m.claimable + m.total_claimed),
            "I2: credited == claimable + claimed"
        );
        // I4: after any settle, received members without open debts hold
        // at most `need` (declining release ran). `need` is relative to the
        // last settled round, i.e. c * (n - circle.round).
        if circle.round > 0 {
            let n = circle.members.len();
            let need = circle.contribution * i128::from(n.saturating_sub(circle.round));
            for m in &sts {
                let open: i128 = m.debts.iter().map(|d| d.amount).sum();
                if m.received && open == 0 {
                    assert!(m.collateral <= need, "I4 declining release");
                }
            }
        }
        // I3 non-negative
        assert!(circle.pot >= 0);
        for m in &sts {
            assert!(m.collateral >= 0 && m.claimable >= 0, "I3");
            for d in m.debts.iter() {
                assert!(d.amount >= 0, "I3 debt");
            }
        }
    }
    // I1 solvency
    assert_eq!(s.token.balance(&s.contract), held_total, "I1 solvency");
}

pub(crate) fn claim_all(s: &Setup, id: u32) {
    for m in s.client.get_circle(&id).members.iter() {
        if s.client.get_member_state(&id, &m).claimable > 0 {
            s.client.claim(&id, &m);
            check_invariants(s, &[id]);
        }
    }
}

/// Token balance change since setup.
fn net(s: &Setup, i: u32) -> i128 {
    s.token.balance(&mem(s, i)) - s.start
}

// ------------------------------------------------------- C1: create/pinning

#[test]
fn token_is_pinned() {
    let s = setup_n(3);
    // the token is fixed by the constructor; create_circle has no token argument
    assert_eq!(s.client.token(), s.token.address);
    let id = create(&s);
    assert_eq!(s.client.get_circle(&id).token, s.token.address);
    check_invariants(&s, &[id]);
}

#[test]
fn min_period_enforced() {
    let s = setup_n(3);
    // v1 accepted a 1-second round
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &C, &s.members, &(MIN_PERIOD_SECS - 1), &JOIN),
        Err(Ok(Error::InvalidPeriod))
    );
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &C, &s.members, &PERIOD, &(MIN_PERIOD_SECS - 1)),
        Err(Ok(Error::InvalidPeriod))
    );
    let id = s
        .client
        .create_circle(&s.admin, &C, &s.members, &MIN_PERIOD_SECS, &MIN_PERIOD_SECS);
    assert_eq!(s.client.get_circle(&id).period_secs, MIN_PERIOD_SECS);
    check_invariants(&s, &[id]);
}

#[test]
fn max_members_20() {
    let s = setup_n(2);
    assert_eq!(MAX_MEMBERS, 20);
    let mut big = Vec::new(&s.env);
    for _ in 0..21 {
        big.push_back(Address::generate(&s.env));
    }
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &C, &big, &PERIOD, &JOIN),
        Err(Ok(Error::TooManyMembers))
    );
    big.pop_back();
    assert_eq!(
        s.client.create_circle(&s.admin, &C, &big, &PERIOD, &JOIN),
        0
    );
}

#[test]
fn amount_too_large() {
    let s = setup_n(2);
    let c = i128::from(i64::MAX / 2);
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &c, &s.members, &PERIOD, &JOIN),
        Err(Ok(Error::AmountTooLarge))
    );
    // c * n * 2 = i64::MAX - 3 is still fine
    let ok = i128::from(i64::MAX / 4);
    assert_eq!(
        s.client
            .create_circle(&s.admin, &ok, &s.members, &PERIOD, &JOIN),
        0
    );
}

#[test]
fn invalid_create_params() {
    let s = setup_n(3);
    let a = mem(&s, 0);
    let b = mem(&s, 1);
    let try_create = |c: i128, m: &Vec<Address>, p: u64, j: u64| {
        s.client.try_create_circle(&s.admin, &c, m, &p, &j)
    };
    // fewer than two members
    assert_eq!(
        try_create(C, &vec![&s.env, a.clone()], PERIOD, JOIN),
        Err(Ok(Error::TooFewMembers))
    );
    assert_eq!(
        try_create(C, &Vec::new(&s.env), PERIOD, JOIN),
        Err(Ok(Error::TooFewMembers))
    );
    // duplicates
    assert_eq!(
        try_create(
            C,
            &vec![&s.env, a.clone(), b.clone(), a.clone()],
            PERIOD,
            JOIN
        ),
        Err(Ok(Error::DuplicateMember))
    );
    // non-positive contribution
    assert_eq!(
        try_create(0, &s.members, PERIOD, JOIN),
        Err(Ok(Error::InvalidContribution))
    );
    assert_eq!(
        try_create(-5, &s.members, PERIOD, JOIN),
        Err(Ok(Error::InvalidContribution))
    );
    // zero period / window
    assert_eq!(
        try_create(C, &s.members, 0, JOIN),
        Err(Ok(Error::InvalidPeriod))
    );
    assert_eq!(
        try_create(C, &s.members, PERIOD, 0),
        Err(Ok(Error::InvalidPeriod))
    );
    assert_eq!(s.client.circle_count(), 0);

    // a valid circle starts Forming with a join deadline and a state per member
    let id = create(&s);
    let circle = s.client.get_circle(&id);
    assert_eq!(circle.status, CircleStatus::Forming);
    assert_eq!(circle.join_deadline, T0 + JOIN);
    assert_eq!(circle.accepted, 0);
    assert_eq!(state(&s, id, 2).slot, 2);
    assert_eq!(s.client.circle_count(), 1);
    // ids are sequential and circles independent
    let two = vec![&s.env, b.clone(), mem(&s, 2)];
    assert_eq!(
        s.client.create_circle(&s.admin, &C, &two, &PERIOD, &JOIN),
        1
    );
    assert_eq!(
        s.client.try_get_member_state(&1, &a),
        Err(Ok(Error::NotMember))
    );
    assert_eq!(s.client.try_get_circle(&7), Err(Ok(Error::CircleNotFound)));
    check_invariants(&s, &[id]);
}

// ------------------------------------------- C2: consent, forming, cancel

#[test]
fn create_requires_admin_auth_only() {
    let s = setup_n(3);
    let id = create(&s);
    // only the admin signed create_circle; members did not
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
    assert_eq!(s.client.get_circle(&id).accepted, 0);
    check_invariants(&s, &[id]);
}

#[test]
#[should_panic]
fn create_without_admin_auth_panics() {
    let env = Env::default();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let contract = env.register(AjoContract, (sac.address(),));
    let client = AjoContractClient::new(&env, &contract);
    let members = vec![&env, Address::generate(&env), Address::generate(&env)];
    // no mock_all_auths -> admin.require_auth() fails
    client.create_circle(&Address::generate(&env), &C, &members, &PERIOD, &JOIN);
}

#[test]
fn accept_requires_member_auth() {
    let s = setup_n(3);
    let id = create(&s);
    let a = mem(&s, 0);
    s.client.accept(&id, &a, &(2 * C));
    assert_eq!(
        s.env.auths()[0],
        (
            a.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.contract.clone(),
                    Symbol::new(&s.env, "accept"),
                    (id, a.clone(), 2 * C).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.token.address.clone(),
                        Symbol::new(&s.env, "transfer"),
                        (a.clone(), s.contract.clone(), 2 * C).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )
    );
    let st = state(&s, id, 0);
    assert!(st.accepted);
    assert_eq!(st.collateral, 2 * C);
    assert_eq!(st.total_in, 2 * C);
    assert_eq!(s.token.balance(&s.contract), 2 * C);
    assert_eq!(s.token.balance(&a), s.start - 2 * C);
    check_invariants(&s, &[id]);
}

#[test]
#[should_panic]
fn accept_without_member_auth_panics() {
    let s = setup_n(3);
    let id = create(&s);
    s.env.set_auths(&[]);
    s.client.accept(&id, &mem(&s, 0), &0);
}

#[test]
fn activates_when_all_accept() {
    let s = setup_n(3);
    let id = create(&s);
    s.client.accept(&id, &mem(&s, 0), &0);
    s.client.accept(&id, &mem(&s, 1), &0);
    assert_eq!(s.client.get_circle(&id).status, CircleStatus::Forming);
    set_time(&s, T0 + 100);
    s.client.accept(&id, &mem(&s, 2), &0);
    let circle = s.client.get_circle(&id);
    assert_eq!(circle.status, CircleStatus::Active);
    assert_eq!(circle.accepted, 3);
    assert_eq!(circle.round_start, T0 + 100);
    assert_eq!(
        s.client.get_round_status(&id, &0).deadline,
        T0 + 100 + PERIOD
    );
    check_invariants(&s, &[id]);
}

#[test]
fn contribute_before_active_rejected() {
    let s = setup_n(3);
    let id = create(&s);
    s.client.accept(&id, &mem(&s, 0), &0);
    assert_eq!(
        s.client.try_contribute(&id, &mem(&s, 0)),
        Err(Ok(Error::NotActive))
    );
    assert_eq!(
        s.client.try_post_collateral(&id, &mem(&s, 0), &C),
        Err(Ok(Error::NotActive))
    );
    check_invariants(&s, &[id]);
}

#[test]
fn accept_twice_rejected() {
    let s = setup_n(3);
    let id = create(&s);
    s.client.accept(&id, &mem(&s, 1), &C);
    assert_eq!(
        s.client.try_accept(&id, &mem(&s, 1), &0),
        Err(Ok(Error::AlreadyAccepted))
    );
    assert_eq!(state(&s, id, 1).collateral, C);
    check_invariants(&s, &[id]);
}

#[test]
fn accept_after_window_rejected() {
    let s = setup_n(3);
    let id = create(&s);
    set_time(&s, T0 + JOIN);
    s.client.accept(&id, &mem(&s, 0), &0); // at the deadline: still ok
    set_time(&s, T0 + JOIN + 1);
    assert_eq!(
        s.client.try_accept(&id, &mem(&s, 1), &0),
        Err(Ok(Error::JoinWindowClosed))
    );
    check_invariants(&s, &[id]);
}

#[test]
fn non_member_accept_rejected() {
    let s = setup_n(3);
    let id = create(&s);
    let outsider = Address::generate(&s.env);
    assert_eq!(
        s.client.try_accept(&id, &outsider, &0),
        Err(Ok(Error::NotMember))
    );
    assert_eq!(
        s.client.try_accept(&9, &outsider, &0),
        Err(Ok(Error::CircleNotFound))
    );
    let id2 = start(&s, &[0, 0, 0]);
    assert_eq!(
        s.client.try_accept(&id2, &mem(&s, 0), &0),
        Err(Ok(Error::NotForming))
    );
    assert_eq!(
        s.client.try_contribute(&id2, &outsider),
        Err(Ok(Error::NotMember))
    );
    check_invariants(&s, &[id, id2]);
}

#[test]
fn collateral_validation() {
    let s = setup_n(3);
    let id = create(&s);
    let (a, b, c) = (mem(&s, 0), mem(&s, 1), mem(&s, 2));
    // R = [2c, c, 0]
    for bad in [-C, C / 2, C + 1, 3 * C] {
        assert_eq!(
            s.client.try_accept(&id, &a, &bad),
            Err(Ok(Error::InvalidCollateral))
        );
    }
    assert_eq!(
        s.client.try_accept(&id, &b, &(2 * C)),
        Err(Ok(Error::InvalidCollateral))
    );
    assert_eq!(
        s.client.try_accept(&id, &c, &C),
        Err(Ok(Error::InvalidCollateral))
    );
    s.client.accept(&id, &a, &C);
    s.client.accept(&id, &b, &0);
    s.client.accept(&id, &c, &0);

    // Active, before receiving: cap is R_slot
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &0),
        Err(Ok(Error::InvalidCollateral))
    );
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &(C / 2)),
        Err(Ok(Error::InvalidCollateral))
    );
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &(2 * C)),
        Err(Ok(Error::InvalidCollateral))
    );
    assert_eq!(
        s.client.try_post_collateral(&id, &c, &C),
        Err(Ok(Error::InvalidCollateral))
    );
    s.client.post_collateral(&id, &a, &C);
    s.client.post_collateral(&id, &b, &C);
    assert_eq!(state(&s, id, 0).collateral, 2 * C);
    assert_eq!(state(&s, id, 0).total_in, 2 * C);
    assert_eq!(s.token.balance(&s.contract), 3 * C);
    assert_eq!(
        s.client
            .try_post_collateral(&id, &Address::generate(&s.env), &C),
        Err(Ok(Error::NotMember))
    );
    check_invariants(&s, &[id]);
}

#[test]
fn post_collateral_cap_after_receiving_is_need() {
    let s = setup_n(4);
    let id = start(&s, &[0, 0, 0, 0]);
    // r0: only A pays -> pot c, all of it withheld (need 3c)
    s.client.contribute(&id, &mem(&s, 0));
    set_time(&s, T0 + PERIOD);
    s.client.settle(&id);
    check_invariants(&s, &[id]);
    let a = mem(&s, 0);
    assert_eq!(state(&s, id, 0).collateral, C);
    // round 1: cap = need = c * (n - 1 - 1) = 2c
    assert_eq!(s.client.required_collateral(&id, &a), C);
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &(2 * C)),
        Err(Ok(Error::InvalidCollateral))
    );
    s.client.post_collateral(&id, &a, &C);
    assert_eq!(state(&s, id, 0).collateral, 2 * C);
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &C),
        Err(Ok(Error::InvalidCollateral))
    );
    assert_eq!(s.client.required_collateral(&id, &a), 0);
    check_invariants(&s, &[id]);
}

#[test]
fn cancel_refunds_collateral() {
    let s = setup_n(3);
    let id = create(&s);
    s.client.accept(&id, &mem(&s, 0), &(2 * C));
    s.client.accept(&id, &mem(&s, 1), &C);
    // before the deadline
    assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::CancelNotAllowed)));
    set_time(&s, T0 + JOIN);
    assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::CancelNotAllowed)));
    set_time(&s, T0 + JOIN + 1);
    s.client.cancel(&id); // anyone; no auth needed
    assert!(s.env.auths().is_empty());
    let circle = s.client.get_circle(&id);
    assert_eq!(circle.status, CircleStatus::Cancelled);
    assert_eq!(state(&s, id, 0).claimable, 2 * C);
    assert_eq!(state(&s, id, 1).claimable, C);
    assert_eq!(state(&s, id, 2).claimable, 0);
    assert_eq!(state(&s, id, 0).collateral, 0);
    assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::NotForming)));
    assert_eq!(
        s.client.try_accept(&id, &mem(&s, 2), &0),
        Err(Ok(Error::NotForming))
    );
    assert_eq!(
        s.client.try_contribute(&id, &mem(&s, 0)),
        Err(Ok(Error::CircleClosed))
    );
    check_invariants(&s, &[id]);
}

#[test]
fn cancel_not_allowed_once_all_accepted() {
    let s = setup_n(2);
    let id = start(&s, &[0, 0]);
    set_time(&s, T0 + JOIN + 1);
    assert_eq!(s.client.try_cancel(&id), Err(Ok(Error::NotForming)));
    check_invariants(&s, &[id]);
}

#[test]
fn duplicate_contribution_rejected() {
    let s = setup_n(3);
    let id = start(&s, &[0, 0, 0]);
    let m = mem(&s, 0);
    s.client.contribute(&id, &m);
    assert_eq!(
        s.client.try_contribute(&id, &m),
        Err(Ok(Error::AlreadyContributed))
    );
    // only charged once
    assert_eq!(s.token.balance(&s.contract), C);
    assert_eq!(state(&s, id, 0).paid, 1);
    assert_eq!(state(&s, id, 0).total_in, C);
    check_invariants(&s, &[id]);
}

// ------------------------------------------------------------ C3: claims

#[test]
fn claim_nothing() {
    let s = setup_n(3);
    let id = start(&s, &[0, 0, 0]);
    assert_eq!(
        s.client.try_claim(&id, &mem(&s, 0)),
        Err(Ok(Error::NothingToClaim))
    );
    assert_eq!(
        s.client.try_claim(&id, &Address::generate(&s.env)),
        Err(Ok(Error::NotMember))
    );
    check_invariants(&s, &[id]);
}

#[test]
fn claim_requires_auth() {
    let s = setup_n(2);
    let id = create(&s);
    s.client.accept(&id, &mem(&s, 0), &C);
    set_time(&s, T0 + JOIN + 1);
    s.client.cancel(&id);
    // without auth mocks a stranger cannot claim A's refund
    s.env.set_auths(&[]);
    assert!(s.client.try_claim(&id, &mem(&s, 0)).is_err());
    assert_eq!(state(&s, id, 0).claimable, C);
    // with A's auth the claim goes to A
    s.env.mock_all_auths();
    assert_eq!(s.client.claim(&id, &mem(&s, 0)), C);
    assert_eq!(s.env.auths()[0].0, mem(&s, 0));
    check_invariants(&s, &[id]);
}

#[test]
fn claim_after_completed_and_cancelled() {
    let s = setup_n(2);
    // cancelled circle
    let cid = create(&s);
    s.client.accept(&cid, &mem(&s, 0), &C);
    set_time(&s, T0 + JOIN + 1);
    s.client.cancel(&cid);
    check_invariants(&s, &[cid]);
    claim_all(&s, cid);
    assert_eq!(s.client.get_circle(&cid).status, CircleStatus::Cancelled);
    assert_eq!(net(&s, 0), 0);
    let st = state(&s, cid, 0);
    assert_eq!((st.claimable, st.total_claimed), (0, C));

    // completed circle
    let id = start(&s, &[0, 0]);
    for _ in 0..2 {
        s.client.contribute(&id, &mem(&s, 0));
        s.client.contribute(&id, &mem(&s, 1));
        s.client.payout(&id);
        check_invariants(&s, &[cid, id]);
    }
    assert_eq!(s.client.get_circle(&id).status, CircleStatus::Completed);
    claim_all(&s, id);
    check_invariants(&s, &[cid, id]);
    assert_eq!((net(&s, 0), net(&s, 1)), (0, 0));
    assert_eq!(s.token.balance(&s.contract), 0);
}

// ------------------------------------------- C4: settle, debts, pipeline

/// Runs one round: `pays[i]` members contribute; if anyone is missing, time
/// moves past the deadline; then a stranger settles. Returns the per-member
/// claimable delta caused by the settle (including releases).
fn play_round(s: &Setup, id: u32, pays: &[bool]) -> std::vec::Vec<i128> {
    for (i, p) in pays.iter().enumerate() {
        if *p {
            s.client.contribute(&id, &mem(s, i as u32));
            check_invariants(s, &[id]);
        }
    }
    if pays.iter().any(|p| !p) {
        let dl = s.client.get_circle(&id).round_start + PERIOD;
        set_time(s, dl);
    }
    let before: std::vec::Vec<i128> = states(s, id).iter().map(|m| m.claimable).collect();
    s.client.settle(&id);
    check_invariants(s, &[id]);
    states(s, id)
        .iter()
        .zip(before)
        .map(|(m, b)| m.claimable - b)
        .collect()
}

fn colls(s: &Setup, id: u32) -> std::vec::Vec<i128> {
    states(s, id).iter().map(|m| m.collateral).collect()
}

fn nets(s: &Setup) -> std::vec::Vec<i128> {
    (0..s.members.len()).map(|i| net(s, i)).collect()
}

fn units(v: &[i128]) -> std::vec::Vec<i128> {
    v.iter().map(|x| x * C).collect()
}

/// Full scenario: posts (in units of c), pays[round][member]. Returns
/// per-round claimable deltas (units of c) and final nets after claim_all.
fn scenario(
    n: u32,
    posts: &[i128],
    pays: &[&[bool]],
) -> (Setup<'static>, u32, std::vec::Vec<std::vec::Vec<i128>>) {
    let s = setup_n(n);
    let id = start(&s, &units(posts));
    check_invariants(&s, &[id]);
    let mut deltas = std::vec::Vec::new();
    for p in pays.iter().take(n as usize) {
        let d = play_round(&s, id, p);
        deltas.push(d.iter().map(|x| x / C).collect());
    }
    assert_eq!(s.client.get_circle(&id).status, CircleStatus::Completed);
    claim_all(&s, id);
    assert_eq!(s.token.balance(&s.contract), 0);
    (s, id, deltas)
}

const T: bool = true;
const F: bool = false;

#[test]
fn reg_circle5_trace_no_collateral() {
    // r0 all pay; r1 A misses; r2 C (the recipient) misses
    let s = setup_n(3);
    let id = start(&s, &[0, 0, 0]);
    let d0 = play_round(&s, id, &[T, T, T]);
    assert_eq!(s.client.get_round_status(&id, &0).pot, 3 * C);
    assert_eq!(d0, units(&[1, 0, 0]));
    assert_eq!(colls(&s, id), units(&[2, 0, 0]));
    let d1 = play_round(&s, id, &[F, T, T]);
    let r1 = s.client.get_round_status(&id, &1);
    assert_eq!(
        (r1.pot, r1.covered_from_collateral, r1.debts_created),
        (3 * C, C, 0)
    );
    assert_eq!(d1, units(&[0, 2, 0]));
    let d2 = play_round(&s, id, &[T, T, F]);
    assert_eq!(s.client.get_round_status(&id, &2).pot, 2 * C);
    assert_eq!(d2, units(&[1, 1, 2]));
    claim_all(&s, id);
    // v1 gave +10/-10/0
    assert_eq!(nets(&s), [0, 0, 0]);
    check_invariants(&s, &[id]);
}

#[test]
fn reg_circle5_trace_full_collateral() {
    let (s, _, d) = scenario(3, &[2, 1, 0], &[&[T, T, T], &[F, T, T], &[T, T, F]]);
    assert_eq!(d, [[3, 0, 0], [0, 3, 0], [1, 1, 2]]);
    assert_eq!(nets(&s), [0, 0, 0]);
}

#[test]
fn reg_walkaway_posted() {
    let (s, id, d) = scenario(3, &[2, 1, 0], &[&[T, T, T], &[F, T, T], &[F, T, T]]);
    assert_eq!(d, [[3, 0, 0], [0, 3, 0], [0, 1, 3]]);
    assert_eq!(s.client.get_round_status(&id, &1).pot, 3 * C);
    assert_eq!(s.client.get_round_status(&id, &2).pot, 3 * C);
    // v1: +20/-10/-10
    assert_eq!(nets(&s), [0, 0, 0]);
}

#[test]
fn reg_walkaway_unposted() {
    let (s, id, d) = scenario(3, &[0, 0, 0], &[&[T, T, T], &[F, T, T], &[F, T, T]]);
    assert_eq!(d, [[1, 0, 0], [0, 2, 0], [0, 1, 3]]);
    assert_eq!(s.client.get_round_status(&id, &0).withheld, 2 * C);
    assert_eq!(nets(&s), [0, 0, 0]);
}

#[test]
fn reg_walkaway_n5_unposted() {
    let a_only_r0: &[bool] = &[F, T, T, T, T];
    let (s, _, d) = scenario(
        5,
        &[0, 0, 0, 0, 0],
        &[&[T, T, T, T, T], a_only_r0, a_only_r0, a_only_r0, a_only_r0],
    );
    assert_eq!(d[0], [1, 0, 0, 0, 0]);
    assert_eq!(d[1], [0, 2, 0, 0, 0]);
    assert_eq!(d[2], [0, 1, 3, 0, 0]);
    assert_eq!(d[3], [0, 1, 1, 4, 0]);
    assert_eq!(d[4], [0, 1, 1, 1, 5]);
    assert_eq!(nets(&s), [0, 0, 0, 0, 0]);
}

#[test]
fn reg_cheap_variant_would_fail() {
    // Arithmetic documentation: a "cheap" variant (collateral only, no
    // withholding) leaves A +10 and C -10 in the walk-away. v2 must not.
    let cheap = [C, 0, -C];
    let (s, _, _) = scenario(3, &[0, 0, 0], &[&[T, T, T], &[F, T, T], &[F, T, T]]);
    let v2 = nets(&s);
    assert_ne!(v2, cheap);
    assert_eq!(v2, [0, 0, 0]);
}

#[test]
fn griefer_middle_never_pays() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 0, 0]));
    let d0 = play_round(&s, id, &[T, F, T]);
    assert_eq!(s.client.get_round_status(&id, &0).pot, 2 * C);
    assert_eq!(d0, units(&[2, 0, 0]));
    let b = state(&s, id, 1);
    assert_eq!(b.debts.len(), 1);
    assert_eq!(
        b.debts.get(0).unwrap(),
        Debt {
            creditor: mem(&s, 0),
            amount: C,
            round: 0
        }
    );
    let d1 = play_round(&s, id, &[T, F, T]);
    let r1 = s.client.get_round_status(&id, &1);
    assert_eq!(
        (r1.pot, r1.to_debts, r1.withheld, r1.to_claimable),
        (2 * C, C, C, 0)
    );
    assert_eq!(d1, units(&[2, 0, 0]));
    let d2 = play_round(&s, id, &[T, F, T]);
    assert_eq!(s.client.get_round_status(&id, &2).pot, 3 * C);
    assert_eq!(d2, units(&[1, 0, 3]));
    assert!(state(&s, id, 1).debts.iter().all(|d| d.amount == 0));
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0]);
}

#[test]
fn griefer_slot0_never_pays() {
    let s = setup_n(3);
    let id = start(&s, &units(&[0, 1, 0]));
    let d0 = play_round(&s, id, &[F, T, T]);
    assert_eq!(s.client.get_round_status(&id, &0).pot, 2 * C);
    assert_eq!(d0, units(&[0, 0, 0]));
    assert_eq!(state(&s, id, 0).collateral, 2 * C);
    assert_eq!(play_round(&s, id, &[F, T, T]), units(&[0, 3, 0]));
    assert_eq!(play_round(&s, id, &[F, T, T]), units(&[0, 1, 3]));
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0]);
    check_invariants(&s, &[id]);
}

#[test]
fn last_member_never_pays() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 1, 0]));
    play_round(&s, id, &[T, T, F]);
    play_round(&s, id, &[T, T, F]);
    let debts = state(&s, id, 2).debts;
    assert_eq!(
        debts.get(0).unwrap(),
        Debt {
            creditor: mem(&s, 0),
            amount: C,
            round: 0
        }
    );
    assert_eq!(
        debts.get(1).unwrap(),
        Debt {
            creditor: mem(&s, 1),
            amount: C,
            round: 1
        }
    );
    let d2 = play_round(&s, id, &[T, T, F]);
    assert_eq!(d2, units(&[2, 2, 0]));
    assert_eq!(s.client.get_round_status(&id, &2).to_debts, 2 * C);
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0]);
    check_invariants(&s, &[id]);
}

#[test]
fn recipient_misses_own_round() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 1, 0]));
    play_round(&s, id, &[T, T, T]);
    let d1 = play_round(&s, id, &[T, F, T]);
    let r1 = s.client.get_round_status(&id, &1);
    assert_eq!(
        (r1.pot, r1.debts_created, r1.covered_from_collateral),
        (2 * C, 0, 0)
    );
    assert_eq!(r1.defaulted, vec![&s.env, mem(&s, 1)]);
    // B's pot is short by its own missing contribution
    assert_eq!(d1, units(&[1, 2, 0]));
    assert_eq!(state(&s, id, 1).missed_rounds, vec![&s.env, 1u32]);
    play_round(&s, id, &[T, T, T]);
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0]);
    check_invariants(&s, &[id]);
}

#[test]
fn happy_path_full_collateral() {
    let (s, id, d) = scenario(3, &[2, 1, 0], &[&[T, T, T], &[T, T, T], &[T, T, T]]);
    assert_eq!(d, [[3, 0, 0], [1, 3, 0], [1, 1, 3]]);
    assert_eq!(nets(&s), [0, 0, 0]);
    assert_eq!(s.token.balance(&s.contract), 0);
    for i in 0..3 {
        let st = state(&s, id, i);
        assert_eq!((st.paid, st.missed, st.received_gross), (3, 0, 3 * C));
        assert_eq!(st.total_in, st.total_claimed);
        let rec = s.client.get_member_record(&id, &mem(&s, i));
        assert_eq!((rec.paid, rec.missed, rec.received), (3, 0, 3 * C));
    }
}

#[test]
fn declining_release_amounts() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 1, 0]));
    play_round(&s, id, &[T, T, T]);
    assert_eq!(colls(&s, id), units(&[2, 1, 0]));
    play_round(&s, id, &[T, T, T]);
    assert_eq!(colls(&s, id), units(&[1, 1, 0]));
    play_round(&s, id, &[T, T, T]);
    assert_eq!(colls(&s, id), units(&[0, 0, 0]));
    check_invariants(&s, &[id]);
}

#[test]
fn debt_fifo_order() {
    // n=4: D (slot 3) misses r0 and r1 -> owes A (r0) then B (r1).
    let s = setup_n(4);
    let id = start(&s, &[0, 0, 0, 0]);
    play_round(&s, id, &[T, T, T, F]);
    play_round(&s, id, &[T, T, T, F]);
    play_round(&s, id, &[T, T, T, T]);
    let debts = state(&s, id, 3).debts;
    assert_eq!(debts.len(), 2);
    assert_eq!(debts.get(0).unwrap().creditor, mem(&s, 0));
    assert_eq!(debts.get(1).unwrap().creditor, mem(&s, 1));
    // r3: D's own pot repays the oldest debt first
    for i in 0..4 {
        s.client.contribute(&id, &mem(&s, i));
    }
    s.client.settle(&id);
    let evs = s.env.events().all().filter_by_contract(&s.contract);
    let repaid_a = DebtRepaid {
        circle_id: id,
        debtor: mem(&s, 3),
        creditor: mem(&s, 0),
        amount: C,
    }
    .to_xdr(&s.env, &s.contract);
    let repaid_b = DebtRepaid {
        circle_id: id,
        debtor: mem(&s, 3),
        creditor: mem(&s, 1),
        amount: C,
    }
    .to_xdr(&s.env, &s.contract);
    let pos = |e: &soroban_sdk::xdr::ContractEvent| {
        evs.events()
            .iter()
            .position(|x| x == e)
            .expect("event emitted")
    };
    assert!(pos(&repaid_a) < pos(&repaid_b));
    assert!(state(&s, id, 3).debts.iter().all(|d| d.amount == 0));
    check_invariants(&s, &[id]);
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0, 0]);
}

#[test]
fn debt_cycle_terminates() {
    // n=4, nobody posts. r0: nobody pays -> A's pot is 0, B, C, D each owe A.
    // r1 (B's turn): A misses with no collateral -> A owes B, while B owes A.
    // Settling r1 sends B's pot around the cycle B -> A -> B.
    let s = setup_n(4);
    let id = start(&s, &[0, 0, 0, 0]);
    play_round(&s, id, &[F, F, F, F]);
    assert_eq!(state(&s, id, 1).debts.get(0).unwrap().creditor, mem(&s, 0));
    assert_eq!(state(&s, id, 0).collateral, 0);
    for i in 1..4 {
        s.client.contribute(&id, &mem(&s, i));
    }
    set_time(&s, s.client.get_circle(&id).round_start + PERIOD);
    s.client.settle(&id);
    let evs = s.env.events().all().filter_by_contract(&s.contract);
    let has = |e: soroban_sdk::xdr::ContractEvent| evs.events().contains(&e);
    // the cycle existed: A owed B and B owed A within the same settle
    assert!(has(DebtCreated {
        circle_id: id,
        debtor: mem(&s, 0),
        creditor: mem(&s, 1),
        round: 1,
        amount: C,
    }
    .to_xdr(&s.env, &s.contract)));
    assert!(has(DebtRepaid {
        circle_id: id,
        debtor: mem(&s, 1),
        creditor: mem(&s, 0),
        amount: C,
    }
    .to_xdr(&s.env, &s.contract)));
    assert!(has(DebtRepaid {
        circle_id: id,
        debtor: mem(&s, 0),
        creditor: mem(&s, 1),
        amount: C,
    }
    .to_xdr(&s.env, &s.contract)));
    // no CreditLoop, both debts cleared, invariants hold
    assert!(state(&s, id, 0).debts.iter().all(|d| d.amount == 0));
    assert!(state(&s, id, 1).debts.iter().all(|d| d.amount == 0));
    check_invariants(&s, &[id]);
    play_round(&s, id, &[T, T, T, T]);
    play_round(&s, id, &[T, T, T, T]);
    claim_all(&s, id);
    assert_eq!(s.token.balance(&s.contract), 0);
    check_invariants(&s, &[id]);
}

#[test]
fn debt_cycle_mutual_debts() {
    // A deliberate X<->Y cycle: n=4. A short of collateral owes later
    // recipients while those owe A from before their turn.
    let s = setup_n(4);
    let id = start(&s, &[0, 0, 0, 0]);
    // r0: B misses (B owes A 1c). A pot 3c -> withheld 3c (need 3c).
    play_round(&s, id, &[T, F, T, T]);
    // r1 (B's turn): A misses -> covered from A's collateral; B's pot repays A.
    play_round(&s, id, &[F, T, T, T]);
    // r2 (C's turn): A and B miss. A covered; B has collateral from its pot.
    play_round(&s, id, &[F, F, T, T]);
    play_round(&s, id, &[F, F, T, T]);
    check_invariants(&s, &[id]);
    claim_all(&s, id);
    assert_eq!(s.token.balance(&s.contract), 0);
    assert!(net(&s, 2) >= 0 && net(&s, 3) >= 0);
}

#[test]
fn frozen_recipient_does_not_brick() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 1, 0]));
    for i in 0..3 {
        s.client.contribute(&id, &mem(&s, i));
    }
    s.issuer.set_flag(IssuerFlags::RevocableFlag);
    s.sac_admin.set_authorized(&mem(&s, 0), &false);
    // settle never transfers, so a frozen recipient cannot block it
    s.client.settle(&id);
    check_invariants(&s, &[id]);
    assert!(s.client.try_claim(&id, &mem(&s, 0)).is_err());
    assert_eq!(state(&s, id, 0).claimable, 3 * C);
    // A can't contribute while frozen: r1 is a miss covered by collateral
    play_round(&s, id, &[F, T, T]);
    play_round(&s, id, &[F, T, T]);
    // others claim fine
    s.client.claim(&id, &mem(&s, 1));
    s.client.claim(&id, &mem(&s, 2));
    check_invariants(&s, &[id]);
    // after re-authorising, A claims
    s.sac_admin.set_authorized(&mem(&s, 0), &true);
    claim_all(&s, id);
    assert_eq!(nets(&s), [0, 0, 0]);
    assert_eq!(s.token.balance(&s.contract), 0);
}

#[test]
fn frozen_contributor_is_a_miss() {
    let s = setup_n(3);
    let id = start(&s, &units(&[2, 0, 0]));
    play_round(&s, id, &[T, T, T]);
    s.issuer.set_flag(IssuerFlags::RevocableFlag);
    s.sac_admin.set_authorized(&mem(&s, 2), &false);
    assert!(s.client.try_contribute(&id, &mem(&s, 2)).is_err());
    check_invariants(&s, &[id]);
    // C (no collateral, not yet received) -> debt to B
    play_round(&s, id, &[T, T, F]);
    let r1 = s.client.get_round_status(&id, &1);
    assert_eq!(r1.debts_created, C);
    assert_eq!(state(&s, id, 2).debts.get(0).unwrap().creditor, mem(&s, 1));
    check_invariants(&s, &[id]);
}

#[test]
fn settle_not_ready() {
    let s = setup_n(3);
    let id = start(&s, &[0, 0, 0]);
    assert_eq!(s.client.try_settle(&id), Err(Ok(Error::PayoutNotReady)));
    s.client.contribute(&id, &mem(&s, 0));
    s.client.contribute(&id, &mem(&s, 1));
    set_time(&s, T0 + PERIOD - 1);
    assert_eq!(s.client.try_settle(&id), Err(Ok(Error::PayoutNotReady)));
    assert!(!s.client.get_round_status(&id, &0).payout_ready);
    set_time(&s, T0 + PERIOD);
    assert!(s.client.get_round_status(&id, &0).payout_ready);
    assert_eq!(s.client.try_settle(&99), Err(Ok(Error::CircleNotFound)));
    let forming = create(&s);
    assert_eq!(s.client.try_settle(&forming), Err(Ok(Error::NotActive)));
    check_invariants(&s, &[id, forming]);
}

#[test]
fn settle_by_anyone() {
    let s = setup_n(2);
    let id = start(&s, &[0, 0]);
    s.client.contribute(&id, &mem(&s, 0));
    s.client.contribute(&id, &mem(&s, 1));
    // no auth at all is needed for settle
    s.env.set_auths(&[]);
    assert_eq!(s.client.settle(&id), 2 * C);
    assert!(s.env.auths().is_empty());
    check_invariants(&s, &[id]);
}

#[test]
fn payout_alias_equals_settle() {
    let a = setup_n(3);
    let b = setup_n(3);
    let ia = start(&a, &units(&[2, 0, 0]));
    let ib = start(&b, &units(&[2, 0, 0]));
    for (s, id, use_payout) in [(&a, ia, false), (&b, ib, true)] {
        for r in 0..3u32 {
            for i in 0..3u32 {
                if i != (r + 1) % 3 {
                    s.client.contribute(&id, &mem(s, i));
                }
            }
            set_time(s, s.client.get_circle(&id).round_start + PERIOD);
            if use_payout {
                s.client.payout(&id);
            } else {
                s.client.settle(&id);
            }
            check_invariants(s, &[id]);
        }
    }
    for i in 0..3 {
        let (x, y) = (state(&a, ia, i), state(&b, ib, i));
        assert_eq!(
            (x.claimable, x.collateral, x.debts.len()),
            (y.claimable, y.collateral, y.debts.len())
        );
    }
    assert_eq!(a.client.try_payout(&ia), Err(Ok(Error::CircleClosed)));
    assert_eq!(a.client.try_settle(&ia), Err(Ok(Error::CircleClosed)));
}

#[test]
fn history_and_round_views() {
    let s = setup_n(3);
    let id = start(&s, &[0, 0, 0]);
    play_round(&s, id, &[T, T, F]);
    let r0 = s.client.get_round_status(&id, &0);
    assert!(r0.settled);
    assert_eq!(r0.recipient, mem(&s, 0));
    assert_eq!(r0.paid, vec![&s.env, mem(&s, 0), mem(&s, 1)]);
    assert_eq!(r0.defaulted, vec![&s.env, mem(&s, 2)]);
    let live = s.client.get_round_status(&id, &1);
    assert!(!live.settled);
    assert_eq!(live.recipient, mem(&s, 1));
    assert_eq!(
        s.client.try_get_round_status(&id, &2),
        Err(Ok(Error::RoundNotFound))
    );
    // required collateral: A received -> need c*(n-1-1)=c, holds 2c withheld
    assert_eq!(s.client.required_collateral(&id, &mem(&s, 0)), 0);
    assert_eq!(s.client.required_collateral(&id, &mem(&s, 1)), C);
    assert_eq!(s.client.required_collateral(&id, &mem(&s, 2)), 0);
    check_invariants(&s, &[id]);
}

#[test]
fn ttl_bumped_on_settle() {
    let s = setup_n(3);
    s.env.ledger().set_sequence_number(100);
    let id = start(&s, &[0, 0, 0]);
    play_round(&s, id, &[T, T, T]);
    // let the entries age, then settle again
    s.env
        .ledger()
        .set_sequence_number(100 + 40 * DAY_IN_LEDGERS);
    play_round(&s, id, &[T, T, T]);
    s.env.as_contract(&s.contract, || {
        let p = s.env.storage().persistent();
        assert_eq!(p.get_ttl(&DataKey::Circle(id)), PERSISTENT_EXTEND_TO);
        for m in s.members.iter() {
            assert_eq!(p.get_ttl(&DataKey::Member(id, m)), PERSISTENT_EXTEND_TO);
        }
        assert_eq!(p.get_ttl(&DataKey::Round(id, 0)), PERSISTENT_EXTEND_TO);
        assert_eq!(p.get_ttl(&DataKey::Round(id, 1)), PERSISTENT_EXTEND_TO);
        assert_eq!(s.env.storage().instance().get_ttl(), INSTANCE_EXTEND_TO);
    });
}
