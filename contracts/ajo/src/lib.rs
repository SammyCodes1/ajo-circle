//! # Ajo Circle
//!
//! A rotating savings group (ajo / esusu / susu / ROSCA) on Soroban.
//!
//! * The contract is deployed with one pinned token (the project's test USDC
//!   Stellar Asset Contract), passed to the constructor. Circles cannot pick
//!   another token.
//! * An admin creates a circle with a fixed list of members, a per-round
//!   contribution and a round length.
//! * Every round each member contributes once. The pot goes to
//!   `members[round % n]`.
//! * Anyone can trigger the payout once every member has paid, or once the
//!   round deadline has passed. Members who did not pay by then are recorded
//!   as having defaulted for that round.
//! * After `n` rounds (everyone received the pot once) the circle closes.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Vec,
};

/// Approximate number of ledgers per day (5 second ledgers).
const DAY_IN_LEDGERS: u32 = 17_280;
/// Instance storage (circle counter) is kept alive for ~30 days.
const INSTANCE_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_EXTEND_TO - DAY_IN_LEDGERS;
/// Persistent entries (circles, round history, member records) ~90 days,
/// re-extended on every touch once they fall below ~60 days.
const PERSISTENT_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;

/// Upper bound on circle size to keep per-call costs bounded.
pub const MAX_MEMBERS: u32 = 20;
/// Minimum round length and join window, in seconds.
pub const MIN_PERIOD_SECS: u64 = 60;
/// `unwind` is allowed once `deadline + UNWIND_GRACE_PERIODS * period` passed.
pub const UNWIND_GRACE_PERIODS: u64 = 2;
/// Hard cap on credit-pipeline iterations per call.
pub const MAX_CREDIT_STEPS: u32 = 2_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Fewer than 2 members.
    TooFewMembers = 1,
    /// Same address appears twice in the member list.
    DuplicateMember = 2,
    /// Contribution must be > 0.
    InvalidContribution = 3,
    /// Round period must be > 0 seconds.
    InvalidPeriod = 4,
    /// No circle with this id.
    CircleNotFound = 5,
    /// Address is not a member of the circle.
    NotMember = 6,
    /// Member already contributed in the current round.
    AlreadyContributed = 7,
    /// Payout not allowed yet: not everyone has paid and deadline not reached.
    PayoutNotReady = 8,
    /// Circle has completed all rounds.
    CircleClosed = 9,
    /// More than MAX_MEMBERS members.
    TooManyMembers = 10,
    /// Requested round does not exist (yet).
    RoundNotFound = 11,
    /// accept/cancel on a circle that is not Forming.
    NotForming = 12,
    /// contribute/settle/unwind/post_collateral when not Active.
    NotActive = 13,
    /// Member already accepted its slot.
    AlreadyAccepted = 14,
    /// accept after join_deadline.
    JoinWindowClosed = 15,
    /// cancel before join_deadline, or all members accepted.
    CancelNotAllowed = 16,
    /// unwind before deadline + UNWIND_GRACE_PERIODS * period.
    UnwindNotAllowed = 17,
    /// Collateral negative, not a multiple of contribution, or above cap.
    InvalidCollateral = 18,
    /// claim with nothing claimable.
    NothingToClaim = 19,
    /// contribution * n * 2 > i64::MAX.
    AmountTooLarge = 20,
    /// MAX_CREDIT_STEPS exceeded (should never happen; unwind is the escape).
    CreditLoop = 21,
    /// Constructor already ran.
    AlreadyInitialized = 22,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CircleStatus {
    /// Created; waiting for every member to accept its slot.
    Forming,
    Active,
    Completed,
    /// Never started (cancel) or unwound.
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub id: u32,
    pub admin: Address,
    /// Copy of the pinned token at creation (for views/UI).
    pub token: Address,
    pub contribution: i128,
    /// Index = slot = payout round.
    pub members: Vec<Address>,
    pub period_secs: u64,
    pub join_deadline: u64,
    /// Number of members that accepted.
    pub accepted: u32,
    /// Current round, 0-based. Equals `members.len()` once completed.
    pub round: u32,
    /// Set when Active; reset to `now` at each settle.
    pub round_start: u64,
    pub created_at: u64,
    pub status: CircleStatus,
    /// Members that have contributed in the current round.
    pub paid: Vec<Address>,
    /// Collected in the current round, not yet settled.
    pub pot: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Debt {
    pub creditor: Address,
    pub amount: i128,
    pub round: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberState {
    pub slot: u32,
    pub accepted: bool,
    /// True from the moment its round is settled.
    pub received: bool,
    /// Held by the contract; backs future contributions.
    pub collateral: i128,
    /// Withdrawable via `claim`.
    pub claimable: i128,
    /// Owed BY this member, FIFO (push_back on create).
    pub debts: Vec<Debt>,
    /// Contributions + collateral posted (token moved IN).
    pub total_in: i128,
    /// Everything ever added to claimable.
    pub total_credited: i128,
    /// Token moved OUT via claim().
    pub total_claimed: i128,
    /// Rounds contributed.
    pub paid: u32,
    pub missed: u32,
    pub missed_rounds: Vec<u32>,
    /// Pot credited to it in its own round (before the pipeline).
    pub received_gross: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundStatus {
    pub circle_id: u32,
    pub round: u32,
    pub recipient: Address,
    /// Round deadline (ledger timestamp, seconds).
    pub deadline: u64,
    pub paid: Vec<Address>,
    /// Members who have not paid (yet) — for the current round this is
    /// "still owing"; for a settled round it equals `defaulted`.
    pub unpaid: Vec<Address>,
    /// Members recorded as defaulted. Empty until the round is settled.
    pub defaulted: Vec<Address>,
    pub pot: i128,
    /// True once this round has been settled.
    pub settled: bool,
    /// True if `settle` can be called right now for this round.
    pub payout_ready: bool,
    /// Sum taken from defaulters' collateral.
    pub covered_from_collateral: i128,
    /// Sum of new Debt amounts.
    pub debts_created: i128,
    /// Part of the recipient's pot used to repay its debts.
    pub to_debts: i128,
    /// Part moved into the recipient's collateral.
    pub withheld: i128,
    /// Part that reached the recipient's claimable.
    pub to_claimable: i128,
}

/// v1-shaped member record, derived from `MemberState`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberRecord {
    /// Number of rounds the member contributed in.
    pub paid: u32,
    /// Number of rounds the member defaulted on.
    pub missed: u32,
    /// Gross pot credited in its own round.
    pub received: i128,
    /// Rounds in which the member defaulted.
    pub missed_rounds: Vec<u32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Instance: pinned token (USDC SAC) address.
    Token,
    /// Instance: number of circles created (next id).
    CircleCount,
    /// Persistent: Circle by id.
    Circle(u32),
    /// Persistent: settled RoundStatus by (circle id, round).
    Round(u32, u32),
    /// Persistent: MemberState by (circle id, member).
    Member(u32, Address),
}

// ---------------------------------------------------------------- events

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCreated {
    #[topic]
    pub circle_id: u32,
    pub admin: Address,
    pub token: Address,
    pub contribution: i128,
    pub members: u32,
    pub period_secs: u64,
    pub join_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberAccepted {
    #[topic]
    pub circle_id: u32,
    #[topic]
    pub member: Address,
    pub slot: u32,
    pub collateral: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleActivated {
    #[topic]
    pub circle_id: u32,
    pub round_start: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralPosted {
    #[topic]
    pub circle_id: u32,
    #[topic]
    pub member: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub circle_id: u32,
    #[topic]
    pub member: Address,
    pub round: u32,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaidOut {
    #[topic]
    pub circle_id: u32,
    #[topic]
    pub recipient: Address,
    pub round: u32,
    pub amount: i128,
    pub defaulted: Vec<Address>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claimed {
    #[topic]
    pub circle_id: u32,
    #[topic]
    pub member: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCancelled {
    #[topic]
    pub circle_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleCompleted {
    #[topic]
    pub circle_id: u32,
}

// ---------------------------------------------------------------- helpers

fn add(a: i128, b: i128) -> i128 {
    a.checked_add(b).expect("overflow")
}

fn mul(a: i128, b: i128) -> i128 {
    a.checked_mul(b).expect("overflow")
}

fn extend_instance(env: &Env) {
    // Extending the instance also extends the contract code.
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
}

fn pinned_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
}

fn load_circle(env: &Env, circle_id: u32) -> Result<Circle, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Circle(circle_id))
        .ok_or(Error::CircleNotFound)
}

fn save_circle(env: &Env, circle: &Circle) {
    env.storage()
        .persistent()
        .set(&DataKey::Circle(circle.id), circle);
}

/// Every member gets a `MemberState` at creation, so a missing entry means
/// "not a member".
fn load_member(env: &Env, circle_id: u32, member: &Address) -> Result<MemberState, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Member(circle_id, member.clone()))
        .ok_or(Error::NotMember)
}

fn save_member(env: &Env, circle_id: u32, member: &Address, st: &MemberState) {
    env.storage()
        .persistent()
        .set(&DataKey::Member(circle_id, member.clone()), st);
}

/// TTL bump (M11): instance + code, the circle, every member key and,
/// optionally, every settled round of the circle.
fn bump_circle(env: &Env, circle: &Circle, include_rounds: bool) {
    extend_instance(env);
    extend_persistent(env, &DataKey::Circle(circle.id));
    for m in circle.members.iter() {
        extend_persistent(env, &DataKey::Member(circle.id, m));
    }
    if include_rounds {
        for k in 0..circle.round {
            extend_persistent(env, &DataKey::Round(circle.id, k));
        }
    }
}

fn new_member_state(env: &Env, slot: u32) -> MemberState {
    MemberState {
        slot,
        accepted: false,
        received: false,
        collateral: 0,
        claimable: 0,
        debts: Vec::new(env),
        total_in: 0,
        total_credited: 0,
        total_claimed: 0,
        paid: 0,
        missed: 0,
        missed_rounds: Vec::new(env),
        received_gross: 0,
    }
}

/// Slot k's collateral target: `R_k = c * (n - 1 - k)`.
fn r_slot(c: i128, n: u32, slot: u32) -> i128 {
    mul(c, i128::from((n - 1).saturating_sub(slot)))
}

/// Collateral a member must hold once it has received, with `r` = the round
/// being settled (or the current round): `c * (n - 1 - r)`, never negative.
fn need(st: &MemberState, c: i128, n: u32, r: u32) -> i128 {
    if st.received {
        mul(c, i128::from((n - 1).saturating_sub(r)))
    } else {
        0
    }
}

/// Raw credit: straight to claimable, no pipeline.
fn credit_raw(st: &mut MemberState, amount: i128) {
    st.claimable = add(st.claimable, amount);
    st.total_credited = add(st.total_credited, amount);
}

fn valid_collateral_amount(amount: i128, c: i128) -> bool {
    amount >= 0 && amount % c == 0
}

fn deadline(circle: &Circle) -> u64 {
    circle.round_start.saturating_add(circle.period_secs)
}

fn is_ready(env: &Env, circle: &Circle) -> bool {
    circle.status == CircleStatus::Active
        && (circle.paid.len() == circle.members.len()
            || env.ledger().timestamp() >= deadline(circle))
}

fn unpaid_members(env: &Env, circle: &Circle) -> Vec<Address> {
    let mut out = Vec::new(env);
    for m in circle.members.iter() {
        if !circle.paid.contains(&m) {
            out.push_back(m);
        }
    }
    out
}

/// Error for calls that need an Active circle.
fn not_active(circle: &Circle) -> Error {
    match circle.status {
        CircleStatus::Completed | CircleStatus::Cancelled => Error::CircleClosed,
        _ => Error::NotActive,
    }
}

// ---------------------------------------------------------------- contract

#[contract]
pub struct AjoContract;

#[contractimpl]
impl AjoContract {
    /// Pins the token (the project's test USDC SAC) for every circle.
    pub fn __constructor(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token, &token);
        extend_instance(&env);
    }

    /// Create a new circle in `Forming`. `admin` must authorize; the admin has
    /// no other powers. Every member must then `accept` its slot before
    /// `join_deadline = now + join_window_secs`. Returns the circle id.
    pub fn create_circle(
        env: Env,
        admin: Address,
        contribution: i128,
        members: Vec<Address>,
        period_secs: u64,
        join_window_secs: u64,
    ) -> Result<u32, Error> {
        admin.require_auth();

        if contribution <= 0 {
            return Err(Error::InvalidContribution);
        }
        if period_secs < MIN_PERIOD_SECS || join_window_secs < MIN_PERIOD_SECS {
            return Err(Error::InvalidPeriod);
        }
        let n = members.len();
        if n < 2 {
            return Err(Error::TooFewMembers);
        }
        if n > MAX_MEMBERS {
            return Err(Error::TooManyMembers);
        }
        for i in 0..n {
            let a = members.get_unchecked(i);
            for j in (i + 1)..n {
                if a == members.get_unchecked(j) {
                    return Err(Error::DuplicateMember);
                }
            }
        }
        match contribution.checked_mul(i128::from(n) * 2) {
            Some(x) if x <= i128::from(i64::MAX) => {}
            _ => return Err(Error::AmountTooLarge),
        }
        let token = pinned_token(&env);

        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CircleCount)
            .unwrap_or(0u32);
        env.storage()
            .instance()
            .set(&DataKey::CircleCount, &(id + 1));

        let now = env.ledger().timestamp();
        let join_deadline = now.saturating_add(join_window_secs);
        let circle = Circle {
            id,
            admin: admin.clone(),
            token: token.clone(),
            contribution,
            members: members.clone(),
            period_secs,
            join_deadline,
            accepted: 0,
            round: 0,
            round_start: 0,
            created_at: now,
            status: CircleStatus::Forming,
            paid: Vec::new(&env),
            pot: 0,
        };
        save_circle(&env, &circle);
        for (i, m) in members.iter().enumerate() {
            save_member(&env, id, &m, &new_member_state(&env, i as u32));
        }
        bump_circle(&env, &circle, false);

        CircleCreated {
            circle_id: id,
            admin,
            token,
            contribution,
            members: n,
            period_secs,
            join_deadline,
        }
        .publish(&env);

        Ok(id)
    }

    /// Accept your slot (member auth), optionally posting collateral now:
    /// `0 <= collateral <= R_slot`, a multiple of the contribution. When the
    /// last member accepts, the circle becomes Active and round 0 starts.
    pub fn accept(
        env: Env,
        circle_id: u32,
        member: Address,
        collateral: i128,
    ) -> Result<(), Error> {
        member.require_auth();
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Forming {
            return Err(Error::NotForming);
        }
        let now = env.ledger().timestamp();
        if now > circle.join_deadline {
            return Err(Error::JoinWindowClosed);
        }
        let mut st = load_member(&env, circle_id, &member)?;
        if st.accepted {
            return Err(Error::AlreadyAccepted);
        }
        let n = circle.members.len();
        let c = circle.contribution;
        if !valid_collateral_amount(collateral, c) || collateral > r_slot(c, n, st.slot) {
            return Err(Error::InvalidCollateral);
        }

        st.collateral = add(st.collateral, collateral);
        st.total_in = add(st.total_in, collateral);
        st.accepted = true;
        circle.accepted += 1;
        let activated = circle.accepted == n;
        if activated {
            circle.status = CircleStatus::Active;
            circle.round_start = now;
        }
        save_member(&env, circle_id, &member, &st);
        save_circle(&env, &circle);
        bump_circle(&env, &circle, false);

        if collateral > 0 {
            token::TokenClient::new(&env, &circle.token).transfer(
                &member,
                env.current_contract_address(),
                &collateral,
            );
        }

        MemberAccepted {
            circle_id,
            member,
            slot: st.slot,
            collateral,
        }
        .publish(&env);
        if activated {
            CircleActivated {
                circle_id,
                round_start: now,
            }
            .publish(&env);
        }
        Ok(())
    }

    /// Post (more) collateral while Active. Cap: `R_slot` before receiving,
    /// `need` at the current round after receiving.
    pub fn post_collateral(
        env: Env,
        circle_id: u32,
        member: Address,
        amount: i128,
    ) -> Result<(), Error> {
        member.require_auth();
        let circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Active {
            return Err(Error::NotActive);
        }
        let mut st = load_member(&env, circle_id, &member)?;
        let n = circle.members.len();
        let c = circle.contribution;
        let cap = if st.received {
            need(&st, c, n, circle.round)
        } else {
            r_slot(c, n, st.slot)
        };
        if amount <= 0 || !valid_collateral_amount(amount, c) || add(st.collateral, amount) > cap {
            return Err(Error::InvalidCollateral);
        }
        st.collateral = add(st.collateral, amount);
        st.total_in = add(st.total_in, amount);
        save_member(&env, circle_id, &member, &st);
        bump_circle(&env, &circle, false);

        token::TokenClient::new(&env, &circle.token).transfer(
            &member,
            env.current_contract_address(),
            &amount,
        );
        CollateralPosted {
            circle_id,
            member,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Cancel a circle that never started (anyone): Forming, past the join
    /// deadline, not everyone accepted. Posted collateral becomes claimable.
    pub fn cancel(env: Env, circle_id: u32) -> Result<(), Error> {
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Forming {
            return Err(Error::NotForming);
        }
        if env.ledger().timestamp() <= circle.join_deadline
            || circle.accepted >= circle.members.len()
        {
            return Err(Error::CancelNotAllowed);
        }
        for m in circle.members.iter() {
            let mut st = load_member(&env, circle_id, &m)?;
            let refund = st.collateral;
            st.collateral = 0;
            credit_raw(&mut st, refund);
            save_member(&env, circle_id, &m, &st);
        }
        circle.status = CircleStatus::Cancelled;
        save_circle(&env, &circle);
        bump_circle(&env, &circle, false);
        CircleCancelled { circle_id }.publish(&env);
        Ok(())
    }

    /// Pay this round's contribution. `member` must authorize; transfers
    /// `contribution` of the pinned token from `member` to this contract.
    /// Late payments are accepted until someone settles the round.
    pub fn contribute(env: Env, circle_id: u32, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Active {
            return Err(not_active(&circle));
        }
        let mut st = load_member(&env, circle_id, &member)?;
        if circle.paid.contains(&member) {
            return Err(Error::AlreadyContributed);
        }
        let c = circle.contribution;
        circle.paid.push_back(member.clone());
        circle.pot = add(circle.pot, c);
        st.total_in = add(st.total_in, c);
        st.paid += 1;
        save_member(&env, circle_id, &member, &st);
        save_circle(&env, &circle);
        bump_circle(&env, &circle, false);

        token::TokenClient::new(&env, &circle.token).transfer(
            &member,
            env.current_contract_address(),
            &c,
        );

        Contributed {
            circle_id,
            member,
            round: circle.round,
            amount: c,
        }
        .publish(&env);
        Ok(())
    }

    /// Settle the current round (interim: the whole pot is credited to the
    /// recipient's claimable; collateral cover and debts come next).
    /// Callable by anyone once every member has paid or the deadline passed.
    pub fn payout(env: Env, circle_id: u32) -> Result<i128, Error> {
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Active {
            return Err(not_active(&circle));
        }
        if !is_ready(&env, &circle) {
            return Err(Error::PayoutNotReady);
        }

        let n = circle.members.len();
        let round = circle.round;
        let recipient = circle.members.get_unchecked(round);
        let amount = circle.pot;
        let defaulted = unpaid_members(&env, &circle);

        for m in defaulted.iter() {
            let mut st = load_member(&env, circle_id, &m)?;
            st.missed += 1;
            st.missed_rounds.push_back(round);
            save_member(&env, circle_id, &m, &st);
        }
        let mut rst = load_member(&env, circle_id, &recipient)?;
        rst.received = true;
        rst.received_gross = add(rst.received_gross, amount);
        credit_raw(&mut rst, amount);
        save_member(&env, circle_id, &recipient, &rst);

        let settled = RoundStatus {
            circle_id,
            round,
            recipient: recipient.clone(),
            deadline: deadline(&circle),
            paid: circle.paid.clone(),
            unpaid: defaulted.clone(),
            defaulted: defaulted.clone(),
            pot: amount,
            settled: true,
            payout_ready: false,
            covered_from_collateral: 0,
            debts_created: 0,
            to_debts: 0,
            withheld: 0,
            to_claimable: amount,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Round(circle_id, round), &settled);

        let now = env.ledger().timestamp();
        circle.round = round + 1;
        circle.round_start = now;
        circle.paid = Vec::new(&env);
        circle.pot = 0;
        if circle.round >= n {
            circle.status = CircleStatus::Completed;
        }
        save_circle(&env, &circle);
        bump_circle(&env, &circle, true);

        PaidOut {
            circle_id,
            recipient,
            round,
            amount,
            defaulted,
        }
        .publish(&env);
        if circle.status == CircleStatus::Completed {
            CircleCompleted { circle_id }.publish(&env);
        }
        Ok(amount)
    }

    /// Withdraw everything claimable (member auth). The only outgoing
    /// transfer in the contract; allowed in any status. State is saved
    /// before the transfer (checks-effects-interactions).
    pub fn claim(env: Env, circle_id: u32, member: Address) -> Result<i128, Error> {
        member.require_auth();
        let circle = load_circle(&env, circle_id)?;
        let mut st = load_member(&env, circle_id, &member)?;
        let x = st.claimable;
        if x == 0 {
            return Err(Error::NothingToClaim);
        }
        st.claimable = 0;
        st.total_claimed = add(st.total_claimed, x);
        save_member(&env, circle_id, &member, &st);
        bump_circle(&env, &circle, false);

        token::TokenClient::new(&env, &circle.token).transfer(
            &env.current_contract_address(),
            &member,
            &x,
        );
        Claimed {
            circle_id,
            member,
            amount: x,
        }
        .publish(&env);
        Ok(x)
    }

    // ------------------------------------------------------------ views

    /// The pinned token (set once by the constructor).
    pub fn token(env: Env) -> Address {
        pinned_token(&env)
    }

    /// Full circle state.
    pub fn get_circle(env: Env, circle_id: u32) -> Result<Circle, Error> {
        load_circle(&env, circle_id)
    }

    /// Number of circles created so far (ids are `0..count`).
    pub fn circle_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CircleCount)
            .unwrap_or(0u32)
    }

    /// Status of `round` in a circle. For the current (open) round this is
    /// computed live; for past rounds the settled record is returned.
    pub fn get_round_status(env: Env, circle_id: u32, round: u32) -> Result<RoundStatus, Error> {
        let circle = load_circle(&env, circle_id)?;
        if round < circle.round {
            return env
                .storage()
                .persistent()
                .get(&DataKey::Round(circle_id, round))
                .ok_or(Error::RoundNotFound);
        }
        if round > circle.round || circle.status != CircleStatus::Active {
            return Err(Error::RoundNotFound);
        }
        Ok(RoundStatus {
            circle_id,
            round,
            recipient: circle.members.get_unchecked(round),
            deadline: deadline(&circle),
            paid: circle.paid.clone(),
            unpaid: unpaid_members(&env, &circle),
            defaulted: Vec::new(&env),
            pot: circle.pot,
            settled: false,
            payout_ready: is_ready(&env, &circle),
            covered_from_collateral: 0,
            debts_created: 0,
            to_debts: 0,
            withheld: 0,
            to_claimable: 0,
        })
    }

    /// Full per-member state (collateral, claimable, debts, totals).
    pub fn get_member_state(
        env: Env,
        circle_id: u32,
        member: Address,
    ) -> Result<MemberState, Error> {
        load_circle(&env, circle_id)?;
        load_member(&env, circle_id, &member)
    }

    /// v1-shaped contribution history, derived from `MemberState`.
    pub fn get_member_record(
        env: Env,
        circle_id: u32,
        member: Address,
    ) -> Result<MemberRecord, Error> {
        load_circle(&env, circle_id)?;
        let st = load_member(&env, circle_id, &member)?;
        Ok(MemberRecord {
            paid: st.paid,
            missed: st.missed,
            received: st.received_gross,
            missed_rounds: st.missed_rounds,
        })
    }
}

#[cfg(test)]
mod test;
