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
    Active,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub id: u32,
    pub admin: Address,
    pub token: Address,
    pub contribution: i128,
    pub members: Vec<Address>,
    pub period_secs: u64,
    /// Current round, 0-based. Equals `members.len()` once completed.
    pub round: u32,
    /// Ledger timestamp at which the current round started.
    pub round_start: u64,
    pub created_at: u64,
    pub status: CircleStatus,
    /// Members that have contributed in the current round.
    pub paid: Vec<Address>,
    /// Amount collected in the current round (held by the contract).
    pub pot: i128,
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
    /// True once the payout for this round has been executed.
    pub settled: bool,
    /// True if `payout` can be called right now for this round.
    pub payout_ready: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberRecord {
    /// Number of rounds the member contributed in.
    pub paid: u32,
    /// Number of rounds the member defaulted on.
    pub missed: u32,
    /// Total amount received from payouts.
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
    /// Persistent: MemberRecord by (circle id, member).
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
pub struct CircleCompleted {
    #[topic]
    pub circle_id: u32,
}

// ---------------------------------------------------------------- helpers

fn extend_instance(env: &Env) {
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
    let key = DataKey::Circle(circle_id);
    let circle: Circle = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::CircleNotFound)?;
    extend_persistent(env, &key);
    Ok(circle)
}

fn save_circle(env: &Env, circle: &Circle) {
    let key = DataKey::Circle(circle.id);
    env.storage().persistent().set(&key, circle);
    extend_persistent(env, &key);
}

fn load_member(env: &Env, circle_id: u32, member: &Address) -> MemberRecord {
    let key = DataKey::Member(circle_id, member.clone());
    match env.storage().persistent().get::<_, MemberRecord>(&key) {
        Some(r) => {
            extend_persistent(env, &key);
            r
        }
        None => MemberRecord {
            paid: 0,
            missed: 0,
            received: 0,
            missed_rounds: Vec::new(env),
        },
    }
}

fn save_member(env: &Env, circle_id: u32, member: &Address, rec: &MemberRecord) {
    let key = DataKey::Member(circle_id, member.clone());
    env.storage().persistent().set(&key, rec);
    extend_persistent(env, &key);
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

    /// Create a new circle. `admin` must authorize. Returns the circle id.
    /// Round 0 starts immediately; its recipient is `members[0]`.
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
        extend_instance(&env);

        let now = env.ledger().timestamp();
        let circle = Circle {
            id,
            admin: admin.clone(),
            token: token.clone(),
            contribution,
            members,
            period_secs,
            round: 0,
            round_start: now,
            created_at: now,
            status: CircleStatus::Active,
            paid: Vec::new(&env),
            pot: 0,
        };
        save_circle(&env, &circle);

        CircleCreated {
            circle_id: id,
            admin,
            token,
            contribution,
            members: n,
            period_secs,
        }
        .publish(&env);

        Ok(id)
    }

    /// Pay this round's contribution. `member` must authorize; transfers
    /// `contribution` of the circle token from `member` to this contract.
    /// Late payments are accepted until someone triggers `payout`.
    pub fn contribute(env: Env, circle_id: u32, member: Address) -> Result<(), Error> {
        member.require_auth();
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Active {
            return Err(Error::CircleClosed);
        }
        if !circle.members.contains(&member) {
            return Err(Error::NotMember);
        }
        if circle.paid.contains(&member) {
            return Err(Error::AlreadyContributed);
        }

        token::TokenClient::new(&env, &circle.token).transfer(
            &member,
            env.current_contract_address(),
            &circle.contribution,
        );

        circle.paid.push_back(member.clone());
        circle.pot += circle.contribution;
        save_circle(&env, &circle);

        let mut rec = load_member(&env, circle_id, &member);
        rec.paid += 1;
        save_member(&env, circle_id, &member, &rec);
        extend_instance(&env);

        Contributed {
            circle_id,
            member,
            round: circle.round,
            amount: circle.contribution,
        }
        .publish(&env);
        Ok(())
    }

    /// Settle the current round. Callable by anyone once every member has
    /// paid or the round deadline has passed. Sends the pot to
    /// `members[round % n]`, records unpaid members as defaulted, and starts
    /// the next round (or closes the circle after the final round).
    /// Returns the amount paid out.
    pub fn payout(env: Env, circle_id: u32) -> Result<i128, Error> {
        let mut circle = load_circle(&env, circle_id)?;
        if circle.status != CircleStatus::Active {
            return Err(Error::CircleClosed);
        }
        if !is_ready(&env, &circle) {
            return Err(Error::PayoutNotReady);
        }

        let n = circle.members.len();
        let round = circle.round;
        let recipient = circle.members.get_unchecked(round % n);
        let amount = circle.pot;
        let defaulted = unpaid_members(&env, &circle);

        if amount > 0 {
            token::TokenClient::new(&env, &circle.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
        }

        // Member bookkeeping.
        for m in defaulted.iter() {
            let mut rec = load_member(&env, circle_id, &m);
            rec.missed += 1;
            rec.missed_rounds.push_back(round);
            save_member(&env, circle_id, &m, &rec);
        }
        let mut rrec = load_member(&env, circle_id, &recipient);
        rrec.received += amount;
        save_member(&env, circle_id, &recipient, &rrec);

        // Round history.
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
        };
        let rkey = DataKey::Round(circle_id, round);
        env.storage().persistent().set(&rkey, &settled);
        extend_persistent(&env, &rkey);

        // Advance.
        let now = env.ledger().timestamp();
        circle.round = round + 1;
        circle.round_start = now;
        circle.paid = Vec::new(&env);
        circle.pot = 0;
        if circle.round >= n {
            circle.status = CircleStatus::Completed;
        }
        save_circle(&env, &circle);
        extend_instance(&env);

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
            let key = DataKey::Round(circle_id, round);
            let r: RoundStatus = env
                .storage()
                .persistent()
                .get(&key)
                .ok_or(Error::RoundNotFound)?;
            extend_persistent(&env, &key);
            return Ok(r);
        }
        if round > circle.round || circle.status != CircleStatus::Active {
            return Err(Error::RoundNotFound);
        }
        let n = circle.members.len();
        Ok(RoundStatus {
            circle_id,
            round,
            recipient: circle.members.get_unchecked(round % n),
            deadline: deadline(&circle),
            paid: circle.paid.clone(),
            unpaid: unpaid_members(&env, &circle),
            defaulted: Vec::new(&env),
            pot: circle.pot,
            settled: false,
            payout_ready: is_ready(&env, &circle),
        })
    }

    /// Contribution history of `member` in a circle.
    pub fn get_member_record(
        env: Env,
        circle_id: u32,
        member: Address,
    ) -> Result<MemberRecord, Error> {
        let circle = load_circle(&env, circle_id)?;
        if !circle.members.contains(&member) {
            return Err(Error::NotMember);
        }
        Ok(load_member(&env, circle_id, &member))
    }
}

#[cfg(test)]
mod test;
