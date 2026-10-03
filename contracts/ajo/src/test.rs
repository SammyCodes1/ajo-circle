#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal, Symbol,
};

const CONTRIB: i128 = 100_0000000; // 100 USDC (7 decimals)
const PERIOD: u64 = 7 * 24 * 60 * 60; // one week
const JOIN: u64 = 24 * 60 * 60; // one day

struct Setup<'a> {
    env: Env,
    client: AjoContractClient<'a>,
    token: TokenClient<'a>,
    admin: Address,
    members: Vec<Address>,
    contract: Address,
}

fn setup(n: u32) -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = TokenClient::new(&env, &sac.address());
    let sac_admin = StellarAssetClient::new(&env, &sac.address());

    let mut members = Vec::new(&env);
    for _ in 0..n {
        let m = Address::generate(&env);
        sac_admin.mint(&m, &(CONTRIB * 10));
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
    }
}

fn create(s: &Setup) -> u32 {
    s.client
        .create_circle(&s.admin, &CONTRIB, &s.members, &PERIOD, &JOIN)
}

#[test]
fn full_happy_cycle() {
    let s = setup(3);
    let id = create(&s);
    // create_circle required the admin's auth (auths() reflects the last call)
    assert_eq!(s.env.auths()[0].0, s.admin);
    assert_eq!(id, 0);
    assert_eq!(s.client.circle_count(), 1);

    for round in 0..3u32 {
        let st = s.client.get_round_status(&id, &round);
        assert_eq!(st.recipient, s.members.get(round).unwrap());
        assert_eq!(st.deadline, s.client.get_circle(&id).round_start + PERIOD);
        assert!(!st.payout_ready);

        for m in s.members.iter() {
            s.client.contribute(&id, &m);
        }
        // contribute requires the member's auth for exactly this call
        let last = s.members.get(2).unwrap();
        assert_eq!(
            s.env.auths()[0],
            (
                last.clone(),
                soroban_sdk::testutils::AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.contract.clone(),
                        Symbol::new(&s.env, "contribute"),
                        (id, last.clone()).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![soroban_sdk::testutils::AuthorizedInvocation {
                        function: AuthorizedFunction::Contract((
                            s.token.address.clone(),
                            Symbol::new(&s.env, "transfer"),
                            (last.clone(), s.contract.clone(), CONTRIB).into_val(&s.env),
                        )),
                        sub_invocations: std::vec![],
                    }],
                }
            )
        );

        let st = s.client.get_round_status(&id, &round);
        assert_eq!(st.paid.len(), 3);
        assert_eq!(st.unpaid.len(), 0);
        assert!(st.payout_ready);
        assert_eq!(s.token.balance(&s.contract), CONTRIB * 3);

        // all paid -> payout allowed immediately, before the deadline
        let paid = s.client.payout(&id);
        assert_eq!(paid, CONTRIB * 3);
        assert_eq!(s.token.balance(&s.contract), 0);

        let settled = s.client.get_round_status(&id, &round);
        assert!(settled.settled);
        assert_eq!(settled.defaulted.len(), 0);
        assert_eq!(settled.pot, CONTRIB * 3);
    }

    // everyone paid 3x and received 3x -> net zero
    for m in s.members.iter() {
        assert_eq!(s.token.balance(&m), CONTRIB * 10);
        let rec = s.client.get_member_record(&id, &m);
        assert_eq!(rec.paid, 3);
        assert_eq!(rec.missed, 0);
        assert_eq!(rec.received, CONTRIB * 3);
    }
    let c = s.client.get_circle(&id);
    assert_eq!(c.status, CircleStatus::Completed);
    assert_eq!(c.round, 3);
}

#[test]
fn duplicate_contribution_rejected() {
    let s = setup(3);
    let id = create(&s);
    let m = s.members.get(0).unwrap();
    s.client.contribute(&id, &m);
    assert_eq!(
        s.client.try_contribute(&id, &m),
        Err(Ok(Error::AlreadyContributed))
    );
    // only charged once
    assert_eq!(s.token.balance(&s.contract), CONTRIB);
}

#[test]
fn non_member_rejected() {
    let s = setup(3);
    let id = create(&s);
    let outsider = Address::generate(&s.env);
    assert_eq!(
        s.client.try_contribute(&id, &outsider),
        Err(Ok(Error::NotMember))
    );
    assert_eq!(
        s.client.try_get_member_record(&id, &outsider),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn unknown_circle_rejected() {
    let s = setup(2);
    let m = s.members.get(0).unwrap();
    assert_eq!(
        s.client.try_contribute(&7, &m),
        Err(Ok(Error::CircleNotFound))
    );
    assert_eq!(s.client.try_payout(&7), Err(Ok(Error::CircleNotFound)));
}

#[test]
fn payout_before_ready_rejected() {
    let s = setup(3);
    let id = create(&s);
    // nobody paid
    assert_eq!(s.client.try_payout(&id), Err(Ok(Error::PayoutNotReady)));
    // two of three paid, deadline not reached
    s.client.contribute(&id, &s.members.get(0).unwrap());
    s.client.contribute(&id, &s.members.get(1).unwrap());
    s.env.ledger().set_timestamp(1_000_000 + PERIOD - 1);
    assert_eq!(s.client.try_payout(&id), Err(Ok(Error::PayoutNotReady)));
    assert!(!s.client.get_round_status(&id, &0).payout_ready);
}

#[test]
fn default_after_period() {
    let s = setup(3);
    let id = create(&s);
    let (a, b, c) = (
        s.members.get(0).unwrap(),
        s.members.get(1).unwrap(),
        s.members.get(2).unwrap(),
    );
    s.client.contribute(&id, &a);
    s.client.contribute(&id, &b);

    // advance ledger time to the deadline
    s.env.ledger().set_timestamp(1_000_000 + PERIOD);
    let live = s.client.get_round_status(&id, &0);
    assert!(live.payout_ready);
    assert_eq!(live.unpaid, vec![&s.env, c.clone()]);

    let a_before = s.token.balance(&a);
    let paid = s.client.payout(&id);
    assert_eq!(paid, CONTRIB * 2);
    assert_eq!(s.token.balance(&a), a_before + CONTRIB * 2);

    let r0 = s.client.get_round_status(&id, &0);
    assert_eq!(r0.defaulted, vec![&s.env, c.clone()]);
    assert_eq!(r0.paid, vec![&s.env, a.clone(), b.clone()]);

    let rec_c = s.client.get_member_record(&id, &c);
    assert_eq!(rec_c.missed, 1);
    assert_eq!(rec_c.paid, 0);
    assert_eq!(rec_c.missed_rounds, vec![&s.env, 0u32]);

    // next round started at the payout time with a fresh deadline
    let circle = s.client.get_circle(&id);
    assert_eq!(circle.round, 1);
    assert_eq!(circle.round_start, 1_000_000 + PERIOD);
    let r1 = s.client.get_round_status(&id, &1);
    assert_eq!(r1.recipient, b);
    assert_eq!(r1.deadline, 1_000_000 + 2 * PERIOD);
    assert_eq!(r1.paid.len(), 0);

    // a round where nobody pays can still be settled after the deadline
    s.env.ledger().set_timestamp(1_000_000 + 2 * PERIOD);
    assert_eq!(s.client.payout(&id), 0);
    assert_eq!(s.client.get_round_status(&id, &1).defaulted.len(), 3);
    assert_eq!(s.client.get_member_record(&id, &c).missed, 2);
}

#[test]
fn closes_after_final_round() {
    let s = setup(2);
    let id = create(&s);
    for _ in 0..2 {
        for m in s.members.iter() {
            s.client.contribute(&id, &m);
        }
        s.client.payout(&id);
    }
    assert_eq!(s.client.get_circle(&id).status, CircleStatus::Completed);
    let m = s.members.get(0).unwrap();
    assert_eq!(
        s.client.try_contribute(&id, &m),
        Err(Ok(Error::CircleClosed))
    );
    assert_eq!(s.client.try_payout(&id), Err(Ok(Error::CircleClosed)));
    assert_eq!(
        s.client.try_get_round_status(&id, &2),
        Err(Ok(Error::RoundNotFound))
    );
    // history stays readable
    assert!(s.client.get_round_status(&id, &1).settled);
}

#[test]
fn invalid_create_params() {
    let s = setup(3);
    let a = s.members.get(0).unwrap();
    let b = s.members.get(1).unwrap();

    // fewer than two members
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &CONTRIB, &vec![&s.env, a.clone()], &PERIOD, &JOIN),
        Err(Ok(Error::TooFewMembers))
    );
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &CONTRIB, &Vec::new(&s.env), &PERIOD, &JOIN),
        Err(Ok(Error::TooFewMembers))
    );
    // duplicates
    assert_eq!(
        s.client.try_create_circle(
            &s.admin,
            &CONTRIB,
            &vec![&s.env, a.clone(), b.clone(), a.clone()],
            &PERIOD,
            &JOIN
        ),
        Err(Ok(Error::DuplicateMember))
    );
    // non-positive contribution
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &0, &s.members, &PERIOD, &JOIN),
        Err(Ok(Error::InvalidContribution))
    );
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &-5, &s.members, &PERIOD, &JOIN),
        Err(Ok(Error::InvalidContribution))
    );
    // zero period
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &CONTRIB, &s.members, &0, &JOIN),
        Err(Ok(Error::InvalidPeriod))
    );
    // too many members
    let mut big = Vec::new(&s.env);
    for _ in 0..(MAX_MEMBERS + 1) {
        big.push_back(Address::generate(&s.env));
    }
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &CONTRIB, &big, &PERIOD, &JOIN),
        Err(Ok(Error::TooManyMembers))
    );
    assert_eq!(s.client.circle_count(), 0);
}

#[test]
#[should_panic]
fn create_requires_admin_auth() {
    let env = Env::default();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let contract = env.register(AjoContract, (sac.address(),));
    let client = AjoContractClient::new(&env, &contract);
    let members = vec![&env, Address::generate(&env), Address::generate(&env)];
    // no mock_all_auths -> admin.require_auth() fails
    client.create_circle(&Address::generate(&env), &CONTRIB, &members, &PERIOD, &JOIN);
}

#[test]
fn multiple_circles_are_independent() {
    let s = setup(3);
    let id0 = create(&s);
    let two = vec![&s.env, s.members.get(1).unwrap(), s.members.get(2).unwrap()];
    let id1 = s
        .client
        .create_circle(&s.admin, &CONTRIB, &two, &PERIOD, &JOIN);
    assert_eq!((id0, id1), (0, 1));
    s.client.contribute(&id1, &s.members.get(1).unwrap());
    assert_eq!(s.client.get_round_status(&id0, &0).paid.len(), 0);
    assert_eq!(s.client.get_round_status(&id1, &0).paid.len(), 1);
    assert_eq!(
        s.client.get_round_status(&id1, &0).recipient,
        s.members.get(1).unwrap()
    );
}

#[test]
fn token_is_pinned() {
    let s = setup(3);
    // the token is fixed by the constructor; create_circle has no token argument
    assert_eq!(s.client.token(), s.token.address);
    let id = create(&s);
    assert_eq!(s.client.get_circle(&id).token, s.token.address);
}

#[test]
fn min_period_enforced() {
    let s = setup(3);
    // v1 accepted a 1-second round
    assert_eq!(
        s.client.try_create_circle(
            &s.admin,
            &CONTRIB,
            &s.members,
            &(MIN_PERIOD_SECS - 1),
            &JOIN
        ),
        Err(Ok(Error::InvalidPeriod))
    );
    assert_eq!(
        s.client.try_create_circle(
            &s.admin,
            &CONTRIB,
            &s.members,
            &PERIOD,
            &(MIN_PERIOD_SECS - 1)
        ),
        Err(Ok(Error::InvalidPeriod))
    );
    let id = s.client.create_circle(
        &s.admin,
        &CONTRIB,
        &s.members,
        &MIN_PERIOD_SECS,
        &MIN_PERIOD_SECS,
    );
    assert_eq!(s.client.get_circle(&id).period_secs, MIN_PERIOD_SECS);
}

#[test]
fn max_members_20() {
    let s = setup(2);
    assert_eq!(MAX_MEMBERS, 20);
    let mut big = Vec::new(&s.env);
    for _ in 0..21 {
        big.push_back(Address::generate(&s.env));
    }
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &CONTRIB, &big, &PERIOD, &JOIN),
        Err(Ok(Error::TooManyMembers))
    );
    big.pop_back();
    assert_eq!(
        s.client
            .create_circle(&s.admin, &CONTRIB, &big, &PERIOD, &JOIN),
        0
    );
}

#[test]
fn amount_too_large() {
    let s = setup(2);
    let c = i128::from(i64::MAX / 2);
    assert_eq!(
        s.client
            .try_create_circle(&s.admin, &c, &s.members, &PERIOD, &JOIN),
        Err(Ok(Error::AmountTooLarge))
    );
    // c * n * 2 == i64::MAX - 1 is still fine
    let ok = i128::from(i64::MAX / 4);
    assert_eq!(
        s.client
            .create_circle(&s.admin, &ok, &s.members, &PERIOD, &JOIN),
        0
    );
}
