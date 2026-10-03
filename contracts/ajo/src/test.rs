#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal, Symbol,
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
    pub admin: Address,
    pub members: Vec<Address>,
    pub contract: Address,
    pub start: i128,
}

pub(crate) fn setup(n: u32, start_balance: i128) -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(T0);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = TokenClient::new(&env, &sac.address());
    let sac_admin = StellarAssetClient::new(&env, &sac.address());

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
    for i in 0..4 {
        s.client.contribute(&id, &mem(&s, i));
    }
    s.client.payout(&id);
    // A has received; now in round 1: need = c * (n - 1 - 1) = 2c
    let a = mem(&s, 0);
    let held = state(&s, id, 0).collateral;
    let cap = 2 * C;
    if held < cap {
        assert_eq!(
            s.client.try_post_collateral(&id, &a, &(cap - held + C)),
            Err(Ok(Error::InvalidCollateral))
        );
        s.client.post_collateral(&id, &a, &(cap - held));
    }
    assert_eq!(state(&s, id, 0).collateral, cap);
    assert_eq!(
        s.client.try_post_collateral(&id, &a, &C),
        Err(Ok(Error::InvalidCollateral))
    );
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
