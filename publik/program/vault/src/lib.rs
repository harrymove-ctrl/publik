pub mod processor;
solana_program::declare_id!("4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx");

fn entry<'a>(program: &solana_program::pubkey::Pubkey, accounts: &'a [solana_program::account_info::AccountInfo<'a>], data: &[u8]) -> solana_program::entrypoint::ProgramResult {
    processor::process_instruction(program, accounts, data)
}
solana_program::entrypoint!(entry);

// Spending rules for one Publik vault. The program reads time from Clock.

pub const MAX_RECIPIENTS: usize = 8;
pub const DAY_SECONDS: i64 = 86_400;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub execution_key: [u8; 32],
    pub per_execution_limit: u64,
    pub daily_limit: u64,
    pub lifetime_limit: u64,
    pub spent_today: u64,
    pub lifetime_spent: u64,
    pub day_index: i64,
    pub paused: bool,
    pub revoked: bool,
    pub start_ts: i64,
    pub expiry_ts: i64,
    pub version: u64,
    pub recipients: Vec<[u8; 32]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyError {
    UnauthorizedSigner,
    Paused,
    Revoked,
    NotYetActive,
    Expired,
    ZeroAmount,
    PerExecution,
    Daily,
    Lifetime,
    InsufficientVault,
    Recipient,
    Version,
    Overflow,
    TooManyRecipients,
    InvalidPolicy,
}

/// Limits must be positive. Lowering a limit below recorded spend is allowed and leaves zero room.
pub fn valid_limits(per: u64, daily: u64, lifetime: u64) -> bool {
    per > 0 && daily > 0 && lifetime > 0
}

pub fn day_index(unix_ts: i64) -> i64 {
    unix_ts.div_euclid(DAY_SECONDS)
}

pub fn execute(
    mut policy: Policy,
    signer: [u8; 32],
    now: i64,
    amount: u64,
    recipient: [u8; 32],
    expected_version: u64,
    vault_balance: u64,
) -> Result<Policy, PolicyError> {
    if signer != policy.execution_key {
        return Err(PolicyError::UnauthorizedSigner);
    }
    if policy.revoked {
        return Err(PolicyError::Revoked);
    }
    if policy.paused {
        return Err(PolicyError::Paused);
    }
    if expected_version != policy.version {
        return Err(PolicyError::Version);
    }
    if now < policy.start_ts {
        return Err(PolicyError::NotYetActive);
    }
    if now >= policy.expiry_ts {
        return Err(PolicyError::Expired);
    }
    if amount == 0 {
        return Err(PolicyError::ZeroAmount);
    }
    if amount > policy.per_execution_limit {
        return Err(PolicyError::PerExecution);
    }
    if !policy.recipients.iter().any(|item| *item == recipient) {
        return Err(PolicyError::Recipient);
    }
    if amount > vault_balance {
        return Err(PolicyError::InsufficientVault);
    }
    let today = day_index(now);
    if today != policy.day_index {
        policy.day_index = today;
        policy.spent_today = 0;
    }
    let day_next = policy.spent_today.checked_add(amount).ok_or(PolicyError::Overflow)?;
    if day_next > policy.daily_limit {
        return Err(PolicyError::Daily);
    }
    let life_next = policy.lifetime_spent.checked_add(amount).ok_or(PolicyError::Overflow)?;
    if life_next > policy.lifetime_limit {
        return Err(PolicyError::Lifetime);
    }
    policy.spent_today = day_next;
    policy.lifetime_spent = life_next;
    Ok(policy)
}

pub fn set_limits(policy: &mut Policy, per: u64, daily: u64, lifetime: u64) -> Result<(), PolicyError> {
    policy.per_execution_limit = per;
    policy.daily_limit = daily;
    policy.lifetime_limit = lifetime;
    policy.version = policy.version.checked_add(1).ok_or(PolicyError::Overflow)?;
    Ok(())
}

pub fn remaining_lifetime(policy: &Policy) -> u64 {
    policy.lifetime_limit.saturating_sub(policy.lifetime_spent)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn policy() -> Policy {
        Policy {
            execution_key: key(1),
            per_execution_limit: 5,
            daily_limit: 10,
            lifetime_limit: 12,
            spent_today: 0,
            lifetime_spent: 0,
            day_index: day_index(1_700_000_000),
            paused: false,
            revoked: false,
            start_ts: 1_700_000_000,
            expiry_ts: 1_800_000_000,
            version: 3,
            recipients: vec![key(9)],
        }
    }

    #[test]
    fn allowed_transfer_updates_counters() {
        let next = execute(policy(), key(1), 1_700_000_100, 4, key(9), 3, 100).unwrap();
        assert_eq!(next.spent_today, 4);
        assert_eq!(next.lifetime_spent, 4);
    }

    #[test]
    fn rejects_wrong_signer_pause_revoke_time_and_recipient() {
        let base = policy();
        assert_eq!(execute(base.clone(), key(2), 1_700_000_100, 1, key(9), 3, 100), Err(PolicyError::UnauthorizedSigner));
        let mut paused = base.clone();
        paused.paused = true;
        assert_eq!(execute(paused, key(1), 1_700_000_100, 1, key(9), 3, 100), Err(PolicyError::Paused));
        let mut revoked = base.clone();
        revoked.revoked = true;
        assert_eq!(execute(revoked, key(1), 1_700_000_100, 1, key(9), 3, 100), Err(PolicyError::Revoked));
        assert_eq!(execute(base.clone(), key(1), 1_600_000_000, 1, key(9), 3, 100), Err(PolicyError::NotYetActive));
        assert_eq!(execute(base.clone(), key(1), 1_800_000_000, 1, key(9), 3, 100), Err(PolicyError::Expired));
        assert_eq!(execute(base.clone(), key(1), 1_700_000_100, 1, key(8), 3, 100), Err(PolicyError::Recipient));
        assert_eq!(execute(base, key(1), 1_700_000_100, 0, key(9), 3, 100), Err(PolicyError::ZeroAmount));
    }

    #[test]
    fn rejects_limits_balance_and_stale_version_without_changing_spend() {
        let base = policy();
        assert_eq!(execute(base.clone(), key(1), 1_700_000_100, 6, key(9), 3, 100), Err(PolicyError::PerExecution));
        let mut spent = base.clone();
        spent.spent_today = 8;
        assert_eq!(execute(spent, key(1), 1_700_000_100, 3, key(9), 3, 100), Err(PolicyError::Daily));
        let mut life = base.clone();
        life.lifetime_spent = 11;
        assert_eq!(execute(life, key(1), 1_700_000_100, 2, key(9), 3, 100), Err(PolicyError::Lifetime));
        assert_eq!(execute(base.clone(), key(1), 1_700_000_100, 4, key(9), 3, 3), Err(PolicyError::InsufficientVault));
        assert_eq!(execute(base, key(1), 1_700_000_100, 1, key(9), 2, 100), Err(PolicyError::Version));
    }
    #[test]
    fn day_rollover_resets_only_the_daily_counter() {
        let mut base = policy();
        base.spent_today = 9;
        base.lifetime_spent = 9;
        let next_day = 1_700_000_000 + DAY_SECONDS;
        let next = execute(base, key(1), next_day, 2, key(9), 3, 100).unwrap();
        assert_eq!(next.spent_today, 2);
        assert_eq!(next.lifetime_spent, 11);
        assert_eq!(next.day_index, day_index(next_day));
    }

    #[test]
    fn lowering_the_lifetime_below_spend_leaves_zero_room() {
        let mut base = policy();
        base.lifetime_spent = 9;
        set_limits(&mut base, 5, 10, 8).unwrap();
        assert_eq!(remaining_lifetime(&base), 0);
        assert_eq!(execute(base, key(1), 1_700_000_100, 1, key(9), 4, 100), Err(PolicyError::Lifetime));
    }

    #[test]
    fn empty_allowlist_rejects_everyone() {
        let mut base = policy();
        base.recipients.clear();
        assert_eq!(execute(base, key(1), 1_700_000_100, 1, key(9), 3, 100), Err(PolicyError::Recipient));
    }
}
