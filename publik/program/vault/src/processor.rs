use solana_program::account_info::AccountInfo;
use solana_program::clock::Clock;
use solana_program::entrypoint::ProgramResult;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::log::sol_log_data;
use solana_program::program::invoke_signed;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;
use solana_program::rent::Rent;
use solana_program::sysvar::Sysvar;

use crate::{execute, valid_limits, Policy, PolicyError, MAX_RECIPIENTS};

const TOKEN_PROGRAM: Pubkey = solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM: Pubkey = solana_program::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM: Pubkey = solana_program::pubkey!("11111111111111111111111111111111");
/// The first release accepts only six-decimal test-token mints.
pub const MINT_DECIMALS: u8 = 6;
const MAGIC: &[u8; 8] = b"PUBLIKV1";
const OFF_OWNER: usize = 8;
const OFF_MINT: usize = 40;
const OFF_VAULT_ID: usize = 72;
const OFF_EXEC: usize = 104;
const OFF_FLAGS: usize = 136;
const OFF_VERSION: usize = 140;
const OFF_LIMITS: usize = 148;
const OFF_LEN: usize = 212;
const OFF_KEYS: usize = 216;
pub const VAULT_LEN: usize = OFF_KEYS + 32 * MAX_RECIPIENTS;
/// RECEIPT1 | recipient wallet | amount | policy version | unix time | execution key | mint
pub const RECEIPT_LEN: usize = 128;
const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;

pub fn process_instruction<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], data: &[u8]) -> ProgramResult {
    let (tag, body) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(program_id, accounts, body),
        1 => edit(program_id, accounts, body, Edit::Configure),
        2 => edit(program_id, accounts, body, Edit::Pause),
        3 => edit(program_id, accounts, body, Edit::Rotate),
        4 => edit(program_id, accounts, body, Edit::Revoke),
        5 => execute_payment(program_id, accounts, body),
        6 => withdraw(program_id, accounts, body),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

enum Edit { Configure, Pause, Rotate, Revoke }

fn initialize<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], data: &[u8]) -> ProgramResult {
    let [owner, vault, authority, vault_token, mint, token_program, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(owner)?;
    require_token_program(token_program)?;
    require_system_program(system)?;
    let vault_id = copy32(take(data, 0, 32)?);
    let execution = copy32(take(data, 32, 32)?);
    let per = read_u64(data, 64)?;
    let daily = read_u64(data, 72)?;
    let lifetime = read_u64(data, 80)?;
    let start = read_i64(data, 88)?;
    let expiry = read_i64(data, 96)?;
    let recipients = read_recipients(&data[104..])?;
    if !valid_limits(per, daily, lifetime) || expiry <= start || execution == owner.key.to_bytes() {
        return Err(map_error(PolicyError::InvalidPolicy));
    }
    let bump = check_vault_address(program_id, owner.key, &vault_id, vault)?;
    check_authority(program_id, vault.key, authority)?;
    check_mint(mint)?;
    check_canonical_token(authority.key, mint.key, vault_token)?;
    if vault.owner == program_id || vault.data_len() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    create_pda(owner, vault, system, VAULT_LEN, program_id, &[b"vault", owner.key.as_ref(), &vault_id, &[bump]])?;
    let policy = Policy {
        execution_key: execution,
        per_execution_limit: per,
        daily_limit: daily,
        lifetime_limit: lifetime,
        spent_today: 0,
        lifetime_spent: 0,
        day_index: 0,
        paused: false,
        revoked: false,
        start_ts: start,
        expiry_ts: expiry,
        version: 1,
        recipients,
    };
    let mut raw = vault.try_borrow_mut_data()?;
    pack(&mut raw, owner.key, mint.key, &vault_id, &policy);
    sol_log_data(&[b"publik:initialize", vault.key.as_ref(), &execution, &1u64.to_le_bytes()]);
    Ok(())
}

fn edit<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], data: &[u8], kind: Edit) -> ProgramResult {
    let [owner, vault, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(owner)?;
    if !vault.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    let expected = read_u64(data, 0)?;
    let (stored_owner, mint, vault_id, mut policy) = unpack(vault, program_id)?;
    if stored_owner != *owner.key {
        return Err(map_error(PolicyError::UnauthorizedSigner));
    }
    if policy.revoked {
        return Err(map_error(PolicyError::Revoked));
    }
    if policy.version != expected {
        return Err(map_error(PolicyError::Version));
    }
    let event: &[u8] = match kind {
        Edit::Configure => {
            let per = read_u64(data, 8)?;
            let daily = read_u64(data, 16)?;
            let lifetime = read_u64(data, 24)?;
            if !valid_limits(per, daily, lifetime) {
                return Err(map_error(PolicyError::InvalidPolicy));
            }
            policy.per_execution_limit = per;
            policy.daily_limit = daily;
            policy.lifetime_limit = lifetime;
            policy.recipients = read_recipients(data.get(32..).ok_or(ProgramError::InvalidInstructionData)?)?;
            b"publik:configure"
        }
        Edit::Pause => {
            policy.paused = match *data.get(8).ok_or(ProgramError::InvalidInstructionData)? {
                0 => false,
                1 => true,
                _ => return Err(ProgramError::InvalidInstructionData),
            };
            b"publik:set_paused"
        }
        Edit::Rotate => {
            let next = copy32(take(data, 8, 32)?);
            if next == stored_owner.to_bytes() || next == policy.execution_key {
                return Err(map_error(PolicyError::InvalidPolicy));
            }
            policy.execution_key = next;
            b"publik:rotate"
        }
        Edit::Revoke => {
            policy.revoked = true;
            b"publik:revoke"
        }
    };
    policy.version = policy.version.checked_add(1).ok_or(map_error(PolicyError::Overflow))?;
    let mut raw = vault.try_borrow_mut_data()?;
    pack(&mut raw, &stored_owner, &mint, &vault_id, &policy);
    sol_log_data(&[event, vault.key.as_ref(), &policy.version.to_le_bytes()]);
    Ok(())
}

fn withdraw<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], data: &[u8]) -> ProgramResult {
    let [owner, vault, authority, source, dest, mint, token_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(owner)?;
    require_token_program(token_program)?;
    let (stored_owner, stored_mint, _, _) = unpack(vault, program_id)?;
    if stored_owner != *owner.key {
        return Err(map_error(PolicyError::UnauthorizedSigner));
    }
    if stored_mint != *mint.key {
        return Err(ProgramError::InvalidAccountData);
    }
    check_authority(program_id, vault.key, authority)?;
    check_canonical_token(authority.key, mint.key, source)?;
    check_token_account(dest, mint.key)?;
    if dest.key == source.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let amount = read_u64(data, 0)?;
    if amount == 0 {
        return Err(map_error(PolicyError::ZeroAmount));
    }
    token_transfer(program_id, source, mint, dest, authority, vault, amount)?;
    sol_log_data(&[b"publik:withdraw", vault.key.as_ref(), &amount.to_le_bytes()]);
    Ok(())
}

fn execute_payment<'a>(program_id: &Pubkey, accounts: &'a [AccountInfo<'a>], data: &[u8]) -> ProgramResult {
    let [agent, vault, authority, source, dest, mint, token_program, system, receipt, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(agent)?;
    require_token_program(token_program)?;
    require_system_program(system)?;
    if !vault.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    let execution_id = copy32(take(data, 0, 32)?);
    let amount = read_u64(data, 32)?;
    let version = read_u64(data, 40)?;
    let (owner, stored_mint, vault_id, policy) = unpack(vault, program_id)?;
    if stored_mint != *mint.key {
        return Err(ProgramError::InvalidAccountData);
    }
    check_authority(program_id, vault.key, authority)?;
    check_canonical_token(authority.key, mint.key, source)?;
    let recipient = token_field(dest, 32)?;
    check_canonical_token(&recipient, mint.key, dest)?;
    if dest.key == source.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let now = Clock::get()?.unix_timestamp;
    let balance = read_u64(&source.try_borrow_data()?, 64)?;
    let signer = agent.key.to_bytes();
    let recipient_bytes = recipient.to_bytes();
    let next = execute(policy, signer, now, amount, recipient_bytes, version, balance).map_err(map_error)?;
    let (expected_receipt, bump) = Pubkey::find_program_address(&[b"receipt", vault.key.as_ref(), &execution_id], program_id);
    if expected_receipt != *receipt.key {
        return Err(ProgramError::InvalidSeeds);
    }
    if receipt.owner == program_id || receipt.data_len() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    create_pda(agent, receipt, system, RECEIPT_LEN, program_id, &[b"receipt", vault.key.as_ref(), &execution_id, &[bump]])?;
    {
        let mut raw = receipt.try_borrow_mut_data()?;
        raw[..8].copy_from_slice(b"RECEIPT1");
        raw[8..40].copy_from_slice(&recipient_bytes);
        raw[40..48].copy_from_slice(&amount.to_le_bytes());
        raw[48..56].copy_from_slice(&version.to_le_bytes());
        raw[56..64].copy_from_slice(&now.to_le_bytes());
        raw[64..96].copy_from_slice(&signer);
        raw[96..128].copy_from_slice(mint.key.as_ref());
    }
    token_transfer(program_id, source, mint, dest, authority, vault, amount)?;
    {
        let mut raw = vault.try_borrow_mut_data()?;
        pack(&mut raw, &owner, mint.key, &vault_id, &next);
    }
    sol_log_data(&[b"publik:execute", vault.key.as_ref(), &execution_id, &recipient_bytes, &amount.to_le_bytes(), &version.to_le_bytes()]);
    Ok(())
}

/// Creates a program-owned PDA. Works even if someone pre-funded the address with lamports.
fn create_pda<'a>(payer: &AccountInfo<'a>, target: &AccountInfo<'a>, system: &AccountInfo<'a>, space: usize, owner: &Pubkey, seeds: &[&[u8]]) -> ProgramResult {
    if !payer.is_writable || !target.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    let needed = Rent::get()?.minimum_balance(space);
    let accounts = [payer.clone(), target.clone(), system.clone()];
    if target.lamports() == 0 {
        let mut ix = system_data(0);
        ix.extend_from_slice(&needed.to_le_bytes());
        ix.extend_from_slice(&(space as u64).to_le_bytes());
        ix.extend_from_slice(owner.as_ref());
        return invoke_signed(&system_ix(payer, target, true, ix), &accounts, &[seeds]);
    }
    let shortfall = needed.saturating_sub(target.lamports());
    if shortfall > 0 {
        let mut ix = system_data(2);
        ix.extend_from_slice(&shortfall.to_le_bytes());
        invoke_signed(&system_ix(payer, target, false, ix), &accounts, &[])?;
    }
    let mut allocate = system_data(8);
    allocate.extend_from_slice(&(space as u64).to_le_bytes());
    invoke_signed(&single_ix(target, allocate), &[target.clone(), system.clone()], &[seeds])?;
    let mut assign = system_data(1);
    assign.extend_from_slice(owner.as_ref());
    invoke_signed(&single_ix(target, assign), &[target.clone(), system.clone()], &[seeds])
}

fn system_data(tag: u32) -> Vec<u8> {
    tag.to_le_bytes().to_vec()
}

fn system_ix(payer: &AccountInfo, target: &AccountInfo, target_signs: bool, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: vec![AccountMeta::new(*payer.key, true), AccountMeta::new(*target.key, target_signs)],
        data,
    }
}

fn single_ix(target: &AccountInfo, data: Vec<u8>) -> Instruction {
    Instruction { program_id: SYSTEM_PROGRAM, accounts: vec![AccountMeta::new(*target.key, true)], data }
}

fn token_transfer<'a>(program_id: &Pubkey, source: &AccountInfo<'a>, mint: &AccountInfo<'a>, dest: &AccountInfo<'a>, authority: &AccountInfo<'a>, vault: &AccountInfo<'a>, amount: u64) -> ProgramResult {
    let (auth, bump) = Pubkey::find_program_address(&[b"authority", vault.key.as_ref()], program_id);
    if auth != *authority.key {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut data = vec![12];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(MINT_DECIMALS);
    invoke_signed(
        &Instruction {
            program_id: TOKEN_PROGRAM,
            accounts: vec![
                AccountMeta::new(*source.key, false),
                AccountMeta::new_readonly(*mint.key, false),
                AccountMeta::new(*dest.key, false),
                AccountMeta::new_readonly(*authority.key, true),
            ],
            data,
        },
        &[source.clone(), mint.clone(), dest.clone(), authority.clone()],
        &[&[b"authority", vault.key.as_ref(), &[bump]]],
    )
}

fn unpack<'a>(vault: &AccountInfo<'a>, program_id: &Pubkey) -> Result<(Pubkey, Pubkey, [u8; 32], Policy), ProgramError> {
    let raw = vault.try_borrow_data()?;
    if vault.owner != program_id || raw.len() != VAULT_LEN || raw[..8] != *MAGIC {
        return Err(ProgramError::InvalidAccountData);
    }
    let owner = Pubkey::new_from_array(copy32(&raw[OFF_OWNER..OFF_MINT]));
    let mint = Pubkey::new_from_array(copy32(&raw[OFF_MINT..OFF_VAULT_ID]));
    let vault_id = copy32(&raw[OFF_VAULT_ID..OFF_EXEC]);
    check_vault_address(program_id, &owner, &vault_id, vault)?;
    let len = raw[OFF_LEN] as usize;
    if len > MAX_RECIPIENTS {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut recipients = Vec::with_capacity(len);
    for index in 0..len {
        let start = OFF_KEYS + index * 32;
        recipients.push(copy32(&raw[start..start + 32]));
    }
    Ok((owner, mint, vault_id, Policy {
        execution_key: copy32(&raw[OFF_EXEC..OFF_FLAGS]),
        per_execution_limit: read_u64(&raw, OFF_LIMITS)?,
        daily_limit: read_u64(&raw, OFF_LIMITS + 8)?,
        lifetime_limit: read_u64(&raw, OFF_LIMITS + 16)?,
        spent_today: read_u64(&raw, OFF_LIMITS + 24)?,
        lifetime_spent: read_u64(&raw, OFF_LIMITS + 32)?,
        day_index: read_i64(&raw, OFF_LIMITS + 40)?,
        paused: raw[OFF_FLAGS + 1] == 1,
        revoked: raw[OFF_FLAGS + 2] == 1,
        start_ts: read_i64(&raw, OFF_LIMITS + 48)?,
        expiry_ts: read_i64(&raw, OFF_LIMITS + 56)?,
        version: read_u64(&raw, OFF_VERSION)?,
        recipients,
    }))
}

fn pack(raw: &mut [u8], owner: &Pubkey, mint: &Pubkey, vault_id: &[u8; 32], policy: &Policy) {
    raw[..8].copy_from_slice(MAGIC);
    raw[OFF_OWNER..OFF_MINT].copy_from_slice(owner.as_ref());
    raw[OFF_MINT..OFF_VAULT_ID].copy_from_slice(mint.as_ref());
    raw[OFF_VAULT_ID..OFF_EXEC].copy_from_slice(vault_id);
    raw[OFF_EXEC..OFF_FLAGS].copy_from_slice(&policy.execution_key);
    raw[OFF_FLAGS + 1] = u8::from(policy.paused);
    raw[OFF_FLAGS + 2] = u8::from(policy.revoked);
    put_u64(raw, OFF_VERSION, policy.version);
    put_u64(raw, OFF_LIMITS, policy.per_execution_limit);
    put_u64(raw, OFF_LIMITS + 8, policy.daily_limit);
    put_u64(raw, OFF_LIMITS + 16, policy.lifetime_limit);
    put_u64(raw, OFF_LIMITS + 24, policy.spent_today);
    put_u64(raw, OFF_LIMITS + 32, policy.lifetime_spent);
    put_i64(raw, OFF_LIMITS + 40, policy.day_index);
    put_i64(raw, OFF_LIMITS + 48, policy.start_ts);
    put_i64(raw, OFF_LIMITS + 56, policy.expiry_ts);
    raw[OFF_LEN] = policy.recipients.len() as u8;
    raw[OFF_KEYS..].fill(0);
    for (index, key) in policy.recipients.iter().enumerate() {
        let start = OFF_KEYS + index * 32;
        raw[start..start + 32].copy_from_slice(key);
    }
}

fn check_vault_address<'a>(program_id: &Pubkey, owner: &Pubkey, vault_id: &[u8], vault: &AccountInfo<'a>) -> Result<u8, ProgramError> {
    let (expected, bump) = Pubkey::find_program_address(&[b"vault", owner.as_ref(), vault_id], program_id);
    if expected == *vault.key { Ok(bump) } else { Err(ProgramError::InvalidSeeds) }
}

fn check_authority<'a>(program_id: &Pubkey, vault: &Pubkey, authority: &AccountInfo<'a>) -> ProgramResult {
    let (expected, _) = Pubkey::find_program_address(&[b"authority", vault.as_ref()], program_id);
    if expected == *authority.key { Ok(()) } else { Err(ProgramError::InvalidSeeds) }
}

fn check_mint<'a>(mint: &AccountInfo<'a>) -> ProgramResult {
    let raw = mint.try_borrow_data()?;
    if *mint.owner != TOKEN_PROGRAM || raw.len() != MINT_LEN || raw[45] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    if raw[44] != MINT_DECIMALS {
        return Err(map_error(PolicyError::InvalidPolicy));
    }
    Ok(())
}

/// A legacy SPL token account for `mint` owned by the token program.
fn check_token_account<'a>(token: &AccountInfo<'a>, mint: &Pubkey) -> ProgramResult {
    if *token.owner != TOKEN_PROGRAM || token.data_len() != TOKEN_ACCOUNT_LEN || token_field(token, 0)? != *mint {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn check_canonical_token<'a>(wallet: &Pubkey, mint: &Pubkey, token: &AccountInfo<'a>) -> ProgramResult {
    let (expected, _) = Pubkey::find_program_address(&[wallet.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()], &ATA_PROGRAM);
    if expected != *token.key || token_field(token, 32)? != *wallet {
        return Err(ProgramError::InvalidAccountData);
    }
    check_token_account(token, mint)
}

fn token_field<'a>(account: &AccountInfo<'a>, offset: usize) -> Result<Pubkey, ProgramError> {
    let raw = account.try_borrow_data()?;
    Ok(Pubkey::new_from_array(copy32(take(&raw, offset, 32)?)))
}

fn require_signer<'a>(account: &AccountInfo<'a>) -> ProgramResult {
    if account.is_signer { Ok(()) } else { Err(ProgramError::MissingRequiredSignature) }
}

fn require_token_program<'a>(account: &AccountInfo<'a>) -> ProgramResult {
    if *account.key == TOKEN_PROGRAM { Ok(()) } else { Err(ProgramError::IncorrectProgramId) }
}

fn require_system_program<'a>(account: &AccountInfo<'a>) -> ProgramResult {
    if *account.key == SYSTEM_PROGRAM { Ok(()) } else { Err(ProgramError::IncorrectProgramId) }
}

fn map_error(error: PolicyError) -> ProgramError {
    ProgramError::Custom(error as u32)
}

fn take(data: &[u8], at: usize, len: usize) -> Result<&[u8], ProgramError> {
    data.get(at..at.checked_add(len).ok_or(ProgramError::InvalidInstructionData)?).ok_or(ProgramError::InvalidInstructionData)
}

fn copy32(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes[..32]);
    out
}

fn read_u64(data: &[u8], at: usize) -> Result<u64, ProgramError> {
    let mut out = [0u8; 8];
    out.copy_from_slice(take(data, at, 8)?);
    Ok(u64::from_le_bytes(out))
}

fn read_i64(data: &[u8], at: usize) -> Result<i64, ProgramError> {
    let mut out = [0u8; 8];
    out.copy_from_slice(take(data, at, 8)?);
    Ok(i64::from_le_bytes(out))
}

fn put_u64(raw: &mut [u8], at: usize, value: u64) {
    raw[at..at + 8].copy_from_slice(&value.to_le_bytes());
}

fn put_i64(raw: &mut [u8], at: usize, value: i64) {
    raw[at..at + 8].copy_from_slice(&value.to_le_bytes());
}

/// `len u8` then `len` 32-byte wallet keys. No trailing bytes, no duplicates, no default key.
fn read_recipients(data: &[u8]) -> Result<Vec<[u8; 32]>, ProgramError> {
    let len = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    if len > MAX_RECIPIENTS {
        return Err(map_error(PolicyError::TooManyRecipients));
    }
    if data.len() != 1 + len * 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut out: Vec<[u8; 32]> = Vec::with_capacity(len);
    for index in 0..len {
        let key = copy32(&data[1 + index * 32..1 + (index + 1) * 32]);
        if key == [0u8; 32] || out.contains(&key) {
            return Err(map_error(PolicyError::InvalidPolicy));
        }
        out.push(key);
    }
    Ok(out)
}
