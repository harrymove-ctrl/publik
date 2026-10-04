//! Executes the compiled `publik_vault.so` in Mollusk against the real SPL Token program.
//! Every rule below is enforced by the program binary, not by Publik's API.

use std::collections::HashMap;

use mollusk_svm::program::keyed_account_for_system_program;
use mollusk_svm::result::InstructionResult;
use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_instruction::error::InstructionError;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;

const TOKEN: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const VERSION: usize = 140;
const SPENT_TODAY: usize = 172;
const LIFETIME_SPENT: usize = 180;
const T0: i64 = 1_700_000_000;
const DAY: i64 = 86_400;

// PolicyError codes, in declaration order.
const UNAUTHORIZED: u32 = 0;
const PAUSED: u32 = 1;
const REVOKED: u32 = 2;
const NOT_YET_ACTIVE: u32 = 3;
const EXPIRED: u32 = 4;
const ZERO: u32 = 5;
const PER_EXECUTION: u32 = 6;
const DAILY: u32 = 7;
const LIFETIME: u32 = 8;
const INSUFFICIENT: u32 = 9;
const RECIPIENT: u32 = 10;
const STALE_VERSION: u32 = 11;
const OVERFLOW: u32 = 12;
const INVALID_POLICY: u32 = 14;
const TOKEN_ACCOUNT_FROZEN: u32 = 17;

fn program_id() -> Pubkey {
    "4Z9q35j8kamid7FECpF3kcU4bgtd7gYxAXg24MRHkzXx".parse().unwrap()
}

fn token_id() -> Pubkey {
    TOKEN.parse().unwrap()
}

fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), token_id().as_ref(), mint.as_ref()], &ATA.parse().unwrap()).0
}

fn token_account(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Account {
    let mut account = Account::new(2_039_280, 165, &token_id());
    account.data[..32].copy_from_slice(mint.as_ref());
    account.data[32..64].copy_from_slice(owner.as_ref());
    account.data[64..72].copy_from_slice(&amount.to_le_bytes());
    account.data[108] = 1;
    account
}

fn mint_account(decimals: u8) -> Account {
    let mut account = Account::new(1_461_600, 82, &token_id());
    account.data[36..44].copy_from_slice(&1_000_000u64.to_le_bytes());
    account.data[44] = decimals;
    account.data[45] = 1;
    account
}

fn u64_at(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

struct Policy {
    per: u64,
    daily: u64,
    lifetime: u64,
    start: i64,
    expiry: i64,
    recipients: Vec<Pubkey>,
}

/// Stateful chain: successful instructions commit their account changes, failed ones commit nothing.
struct Chain {
    mollusk: Mollusk,
    accounts: HashMap<Pubkey, Account>,
    program: Pubkey,
    system: Pubkey,
    owner: Pubkey,
    agent: Pubkey,
    recipient: Pubkey,
    outsider: Pubkey,
    mint: Pubkey,
    vault_id: [u8; 32],
    vault: Pubkey,
    authority: Pubkey,
    vault_token: Pubkey,
}

impl Chain {
    fn new() -> Self {
        std::env::set_var("SBF_OUT_DIR", concat!(env!("CARGO_MANIFEST_DIR"), "/target/deploy"));
        let program = program_id();
        let mut mollusk = Mollusk::new(&program, "publik_vault");
        mollusk.add_program(&token_id(), "spl_token", &solana_sdk_ids::bpf_loader_upgradeable::id());
        mollusk.sysvars.clock.unix_timestamp = T0;
        let (system, system_account) = keyed_account_for_system_program();
        let owner = Pubkey::new_unique();
        let agent = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let outsider = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let vault_id = [7u8; 32];
        let vault = Pubkey::find_program_address(&[b"vault", owner.as_ref(), &vault_id], &program).0;
        let authority = Pubkey::find_program_address(&[b"authority", vault.as_ref()], &program).0;
        let vault_token = ata(&authority, &mint);
        let mut token_program = Account::new(1, 0, &solana_sdk_ids::bpf_loader_upgradeable::id());
        token_program.executable = true;
        let mut accounts = HashMap::new();
        accounts.insert(system, system_account);
        accounts.insert(token_id(), token_program);
        for key in [owner, agent, recipient, outsider] {
            accounts.insert(key, Account::new(10_000_000_000, 0, &system));
        }
        accounts.insert(mint, mint_account(6));
        accounts.insert(vault_token, token_account(&mint, &authority, 0));
        accounts.insert(ata(&owner, &mint), token_account(&mint, &owner, 10_000));
        accounts.insert(ata(&recipient, &mint), token_account(&mint, &recipient, 0));
        accounts.insert(ata(&outsider, &mint), token_account(&mint, &outsider, 0));
        Chain { mollusk, accounts, program, system, owner, agent, recipient, outsider, mint, vault_id, vault, authority, vault_token }
    }

    fn standard_policy(&self) -> Policy {
        Policy { per: 1_000, daily: 2_000, lifetime: 3_000, start: 0, expiry: i64::MAX, recipients: vec![self.recipient] }
    }

    fn run(&mut self, ix: &Instruction) -> InstructionResult {
        let mut keys: Vec<Pubkey> = Vec::new();
        for meta in &ix.accounts {
            if !keys.contains(&meta.pubkey) {
                keys.push(meta.pubkey);
            }
        }
        let rows: Vec<(Pubkey, Account)> = keys
            .iter()
            .map(|key| (*key, self.accounts.get(key).cloned().unwrap_or_else(|| Account::new(0, 0, &self.system))))
            .collect();
        let result = self.mollusk.process_instruction(ix, &rows);
        if result.raw_result.is_ok() {
            for (key, account) in &result.resulting_accounts {
                self.accounts.insert(*key, account.clone());
            }
        }
        result
    }

    fn data(&self, key: &Pubkey) -> Vec<u8> {
        self.accounts.get(key).map(|account| account.data.clone()).unwrap_or_default()
    }

    fn balance(&self, key: &Pubkey) -> u64 {
        u64_at(&self.data(key), 64)
    }

    fn init_ix(&self, signer: &Pubkey, policy: &Policy) -> Instruction {
        let mut data = vec![0];
        data.extend(self.vault_id);
        data.extend(self.agent.to_bytes());
        for value in [policy.per, policy.daily, policy.lifetime] {
            data.extend(value.to_le_bytes());
        }
        data.extend(policy.start.to_le_bytes());
        data.extend(policy.expiry.to_le_bytes());
        data.push(policy.recipients.len() as u8);
        for key in &policy.recipients {
            data.extend(key.to_bytes());
        }
        let vault = Pubkey::find_program_address(&[b"vault", signer.as_ref(), &self.vault_id], &self.program).0;
        let authority = Pubkey::find_program_address(&[b"authority", vault.as_ref()], &self.program).0;
        Instruction::new_with_bytes(self.program, &data, vec![
            AccountMeta::new(*signer, true),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new_readonly(ata(&authority, &self.mint), false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new_readonly(token_id(), false),
            AccountMeta::new_readonly(self.system, false),
        ])
    }

    fn init(&mut self, policy: Policy) {
        let ix = self.init_ix(&self.owner.clone(), &policy);
        let result = self.run(&ix);
        assert!(result.raw_result.is_ok(), "initialize: {:?}", result.raw_result);
        self.fund(1_000_000);
    }

    /// Funding is an ordinary SPL transfer into the vault token account, outside the vault program.
    fn fund(&mut self, amount: u64) {
        let source = ata(&self.owner, &self.mint);
        self.accounts.insert(source, token_account(&self.mint, &self.owner, amount));
        let mut data = vec![12];
        data.extend(amount.to_le_bytes());
        data.push(6);
        let ix = Instruction::new_with_bytes(token_id(), &data, vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new(self.vault_token, false),
            AccountMeta::new_readonly(self.owner, true),
        ]);
        let result = self.run(&ix);
        assert!(result.raw_result.is_ok(), "fund: {:?}", result.raw_result);
    }

    fn version(&self) -> u64 {
        u64_at(&self.data(&self.vault), VERSION)
    }

    fn spent(&self) -> (u64, u64) {
        let data = self.data(&self.vault);
        (u64_at(&data, SPENT_TODAY), u64_at(&data, LIFETIME_SPENT))
    }

    fn receipt(&self, execution_id: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"receipt", self.vault.as_ref(), execution_id], &self.program).0
    }

    fn execute_ix(&self, signer: &Pubkey, recipient_token: &Pubkey, execution_id: [u8; 32], amount: u64, version: u64) -> Instruction {
        let mut data = vec![5];
        data.extend(execution_id);
        data.extend(amount.to_le_bytes());
        data.extend(version.to_le_bytes());
        Instruction::new_with_bytes(self.program, &data, vec![
            AccountMeta::new(*signer, true),
            AccountMeta::new(self.vault, false),
            AccountMeta::new_readonly(self.authority, false),
            AccountMeta::new(self.vault_token, false),
            AccountMeta::new(*recipient_token, false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new_readonly(token_id(), false),
            AccountMeta::new_readonly(self.system, false),
            AccountMeta::new(self.receipt(&execution_id), false),
        ])
    }

    fn pay(&mut self, id: u8, amount: u64) -> InstructionResult {
        let ix = self.execute_ix(&self.agent.clone(), &ata(&self.recipient, &self.mint), [id; 32], amount, self.version());
        self.run(&ix)
    }

    fn edit_ix(&self, signer: &Pubkey, tag: u8, version: u64, tail: &[u8]) -> Instruction {
        let mut data = vec![tag];
        data.extend(version.to_le_bytes());
        data.extend_from_slice(tail);
        Instruction::new_with_bytes(self.program, &data, vec![AccountMeta::new(*signer, true), AccountMeta::new(self.vault, false)])
    }

    fn edit(&mut self, tag: u8, tail: &[u8]) -> InstructionResult {
        let ix = self.edit_ix(&self.owner.clone(), tag, self.version(), tail);
        self.run(&ix)
    }

    fn configure_tail(per: u64, daily: u64, lifetime: u64, recipients: &[Pubkey]) -> Vec<u8> {
        let mut tail = Vec::new();
        for value in [per, daily, lifetime] {
            tail.extend(value.to_le_bytes());
        }
        tail.push(recipients.len() as u8);
        for key in recipients {
            tail.extend(key.to_bytes());
        }
        tail
    }

    fn withdraw_ix(&self, signer: &Pubkey, amount: u64) -> Instruction {
        let mut data = vec![6];
        data.extend(amount.to_le_bytes());
        Instruction::new_with_bytes(self.program, &data, vec![
            AccountMeta::new(*signer, true),
            AccountMeta::new_readonly(self.vault, false),
            AccountMeta::new_readonly(self.authority, false),
            AccountMeta::new(self.vault_token, false),
            AccountMeta::new(ata(signer, &self.mint), false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new_readonly(token_id(), false),
        ])
    }
}

fn custom(result: &InstructionResult) -> Option<u32> {
    match result.raw_result {
        Err(InstructionError::Custom(code)) => Some(code),
        _ => None,
    }
}

#[test]
fn allowed_payment_moves_tokens_and_writes_a_receipt() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    let before = chain.balance(&chain.vault_token);
    let paid = chain.pay(1, 400);
    assert!(paid.raw_result.is_ok(), "execute: {:?}", paid.raw_result);
    assert_eq!(chain.balance(&chain.vault_token), before - 400);
    assert_eq!(chain.balance(&ata(&chain.recipient, &chain.mint)), 400);
    assert_eq!(chain.spent(), (400, 400));
    let receipt = chain.data(&chain.receipt(&[1; 32]));
    assert_eq!(&receipt[..8], b"RECEIPT1");
    assert_eq!(&receipt[8..40], chain.recipient.as_ref());
    assert_eq!(u64_at(&receipt, 40), 400);
    assert_eq!(u64_at(&receipt, 48), 1);
    assert_eq!(&receipt[64..96], chain.agent.as_ref());
    assert_eq!(&receipt[96..128], chain.mint.as_ref());
}

#[test]
fn initialize_creates_the_vault_pda_and_rejects_bad_configurations() {
    let mut chain = Chain::new();
    let unsigned = {
        let mut ix = chain.init_ix(&chain.owner.clone(), &chain.standard_policy());
        ix.accounts[0].is_signer = false;
        ix
    };
    assert_eq!(chain.run(&unsigned).raw_result, Err(InstructionError::MissingRequiredSignature));

    let mut zero_limit = chain.standard_policy();
    zero_limit.per = 0;
    let ix = chain.init_ix(&chain.owner.clone(), &zero_limit);
    assert_eq!(custom(&chain.run(&ix)), Some(INVALID_POLICY));

    let mut backwards = chain.standard_policy();
    backwards.expiry = backwards.start;
    let ix = chain.init_ix(&chain.owner.clone(), &backwards);
    assert_eq!(custom(&chain.run(&ix)), Some(INVALID_POLICY));

    let mut duplicate = chain.standard_policy();
    duplicate.recipients = vec![chain.recipient, chain.recipient];
    let ix = chain.init_ix(&chain.owner.clone(), &duplicate);
    assert_eq!(custom(&chain.run(&ix)), Some(INVALID_POLICY));

    chain.accounts.insert(chain.mint, mint_account(9));
    let ix = chain.init_ix(&chain.owner.clone(), &chain.standard_policy());
    assert_eq!(custom(&chain.run(&ix)), Some(INVALID_POLICY), "non six-decimal mint");
    chain.accounts.insert(chain.mint, mint_account(6));

    // Someone pre-funds the vault address to block creation. Initialization still succeeds.
    chain.accounts.insert(chain.vault, Account::new(5, 0, &chain.system));
    let ix = chain.init_ix(&chain.owner.clone(), &chain.standard_policy());
    let created = chain.run(&ix);
    assert!(created.raw_result.is_ok(), "initialize: {:?}", created.raw_result);
    let vault = chain.accounts.get(&chain.vault).unwrap();
    assert_eq!(vault.owner, chain.program);
    assert_eq!(&vault.data[..8], b"PUBLIKV1");
    assert_eq!(chain.version(), 1);

    assert_eq!(chain.run(&ix).raw_result, Err(InstructionError::AccountAlreadyInitialized));
}

#[test]
fn wrong_signers_and_substituted_accounts_fail() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    let recipient_token = ata(&chain.recipient, &chain.mint);
    let version = chain.version();

    let stranger = chain.outsider;
    let ix = chain.execute_ix(&stranger, &recipient_token, [1; 32], 1, version);
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "wrong execution key");

    let ix = chain.edit_ix(&stranger, 2, version, &[1]);
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "stranger pause");
    let ix = chain.edit_ix(&stranger, 4, version, &[]);
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "stranger revoke");
    let ix = chain.edit_ix(&stranger, 1, version, &Chain::configure_tail(10, 10, 10, &[stranger]));
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "stranger configure");
    let ix = chain.edit_ix(&chain.agent.clone(), 3, version, stranger.as_ref());
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "agent rotates itself");
    chain.accounts.insert(ata(&stranger, &chain.mint), token_account(&chain.mint, &stranger, 0));
    let ix = chain.withdraw_ix(&stranger, 1);
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "stranger withdraw");

    let mut wrong_program = chain.execute_ix(&chain.agent.clone(), &recipient_token, [2; 32], 1, version);
    wrong_program.accounts[6].pubkey = chain.system;
    assert_eq!(chain.run(&wrong_program).raw_result, Err(InstructionError::IncorrectProgramId));

    let other_mint = Pubkey::new_unique();
    chain.accounts.insert(other_mint, mint_account(6));
    let mut wrong_mint = chain.execute_ix(&chain.agent.clone(), &recipient_token, [3; 32], 1, version);
    wrong_mint.accounts[5].pubkey = other_mint;
    assert_eq!(chain.run(&wrong_mint).raw_result, Err(InstructionError::InvalidAccountData));

    // A token account owned by the recipient but not its canonical associated account.
    let side = Pubkey::new_unique();
    chain.accounts.insert(side, token_account(&chain.mint, &chain.recipient, 0));
    let ix = chain.execute_ix(&chain.agent.clone(), &side, [4; 32], 1, version);
    assert_eq!(chain.run(&ix).raw_result, Err(InstructionError::InvalidAccountData));

    // Paying back into the vault itself is ambiguous and rejected.
    let ix = chain.execute_ix(&chain.agent.clone(), &chain.vault_token.clone(), [5; 32], 1, version);
    assert!(chain.run(&ix).raw_result.is_err());

    // A second owner's vault with this vault's authority.
    let mut wrong_vault = chain.execute_ix(&chain.agent.clone(), &recipient_token, [6; 32], 1, version);
    let other = Pubkey::find_program_address(&[b"vault", stranger.as_ref(), &chain.vault_id], &chain.program).0;
    wrong_vault.accounts[1].pubkey = other;
    assert!(chain.run(&wrong_vault).raw_result.is_err());

    // A receipt address that is not the PDA for this execution id.
    let mut wrong_receipt = chain.execute_ix(&chain.agent.clone(), &recipient_token, [7; 32], 1, version);
    wrong_receipt.accounts[8].pubkey = chain.receipt(&[8; 32]);
    assert_eq!(chain.run(&wrong_receipt).raw_result, Err(InstructionError::InvalidSeeds));

    assert_eq!(chain.spent(), (0, 0));
}

#[test]
fn recipient_amount_and_limit_rules() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    let outsider_token = ata(&chain.outsider, &chain.mint);
    let ix = chain.execute_ix(&chain.agent.clone(), &outsider_token, [1; 32], 1, chain.version());
    assert_eq!(custom(&chain.run(&ix)), Some(RECIPIENT));
    assert_eq!(custom(&chain.pay(2, 0)), Some(ZERO));
    assert_eq!(custom(&chain.pay(3, 1_001)), Some(PER_EXECUTION));

    assert!(chain.pay(4, 1_000).raw_result.is_ok());
    assert!(chain.pay(5, 1_000).raw_result.is_ok());
    assert_eq!(custom(&chain.pay(6, 1)), Some(DAILY), "daily limit 2000 reached");
    assert_eq!(chain.spent(), (2_000, 2_000));

    chain.mollusk.sysvars.clock.unix_timestamp = T0 + DAY;
    assert!(chain.pay(7, 1_000).raw_result.is_ok(), "next UTC day resets only the daily counter");
    assert_eq!(chain.spent(), (1_000, 3_000));
    assert_eq!(custom(&chain.pay(8, 1)), Some(LIFETIME), "lifetime 3000 reached");
}

#[test]
fn concurrent_payments_built_from_the_same_view_cannot_exceed_the_daily_limit() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    let version = chain.version();
    let token = ata(&chain.recipient, &chain.mint);
    // Both processes read the same state (spent 0, version 1) and each sends a valid-looking payment.
    let first = chain.execute_ix(&chain.agent.clone(), &token, [1; 32], 1_000, version);
    let second = chain.execute_ix(&chain.agent.clone(), &token, [2; 32], 1_000, version);
    let third = chain.execute_ix(&chain.agent.clone(), &token, [3; 32], 1, version);
    assert!(chain.run(&first).raw_result.is_ok());
    assert!(chain.run(&second).raw_result.is_ok());
    assert_eq!(custom(&chain.run(&third)), Some(DAILY));
    assert_eq!(chain.spent(), (2_000, 2_000));
}

#[test]
fn insufficient_balance_fails_without_touching_counters() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    let ix = chain.init_ix(&chain.owner.clone(), &policy);
    assert!(chain.run(&ix).raw_result.is_ok());
    chain.fund(50);
    assert_eq!(custom(&chain.pay(1, 51)), Some(INSUFFICIENT));
    assert_eq!(chain.spent(), (0, 0));
    assert!(chain.data(&chain.receipt(&[1; 32])).is_empty());
}

#[test]
fn time_window_is_read_from_the_chain_clock() {
    let mut chain = Chain::new();
    let mut policy = chain.standard_policy();
    policy.start = T0 + 100;
    policy.expiry = T0 + 200;
    chain.init(policy);
    assert_eq!(custom(&chain.pay(1, 1)), Some(NOT_YET_ACTIVE));
    chain.mollusk.sysvars.clock.unix_timestamp = T0 + 150;
    assert!(chain.pay(2, 1).raw_result.is_ok());
    chain.mollusk.sysvars.clock.unix_timestamp = T0 + 200;
    assert_eq!(custom(&chain.pay(3, 1)), Some(EXPIRED));
}

#[test]
fn replayed_execution_id_cannot_pay_twice() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    assert!(chain.pay(1, 10).raw_result.is_ok());
    let replay = chain.pay(1, 10);
    assert_eq!(replay.raw_result, Err(InstructionError::AccountAlreadyInitialized));
    assert_eq!(chain.spent(), (10, 10));
    assert_eq!(chain.balance(&ata(&chain.recipient, &chain.mint)), 10);

    // A griefer pre-funding a future receipt address does not block that execution.
    let future = chain.receipt(&[2; 32]);
    chain.accounts.insert(future, Account::new(1, 0, &chain.system));
    assert!(chain.pay(2, 10).raw_result.is_ok());
}

#[test]
fn pause_revoke_rotate_and_stale_versions() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);

    let stale = chain.version();
    assert!(chain.edit(2, &[1]).raw_result.is_ok(), "pause");
    assert_eq!(chain.version(), stale + 1);
    assert_eq!(custom(&chain.pay(1, 1)), Some(PAUSED));
    let ix = chain.edit_ix(&chain.owner.clone(), 2, stale, &[0]);
    assert_eq!(custom(&chain.run(&ix)), Some(STALE_VERSION), "stale UI cannot resume");
    assert!(chain.edit(2, &[0]).raw_result.is_ok(), "resume");

    let token = ata(&chain.recipient, &chain.mint);
    let ix = chain.execute_ix(&chain.agent.clone(), &token, [2; 32], 1, stale);
    assert_eq!(custom(&chain.run(&ix)), Some(STALE_VERSION), "agent built against an old policy");
    assert!(chain.pay(3, 5).raw_result.is_ok());

    let old_key = chain.agent;
    let new_key = Pubkey::new_unique();
    chain.accounts.insert(new_key, Account::new(10_000_000_000, 0, &chain.system));
    assert!(chain.edit(3, new_key.as_ref()).raw_result.is_ok(), "rotate");
    let version = chain.version();
    let ix = chain.execute_ix(&old_key, &token, [4; 32], 1, version);
    assert_eq!(custom(&chain.run(&ix)), Some(UNAUTHORIZED), "old key after rotation");
    let ix = chain.execute_ix(&new_key, &token, [5; 32], 1, version);
    assert!(chain.run(&ix).raw_result.is_ok(), "new key after rotation");
    assert_eq!(chain.spent(), (6, 6), "rotation and pause do not reset spend");

    assert!(chain.edit(4, &[]).raw_result.is_ok(), "revoke");
    let version = chain.version();
    let ix = chain.execute_ix(&new_key, &token, [6; 32], 1, version);
    assert_eq!(custom(&chain.run(&ix)), Some(REVOKED));
    assert_eq!(custom(&chain.edit(2, &[0])), Some(REVOKED), "revoke is terminal");
    assert_eq!(custom(&chain.edit(3, old_key.as_ref())), Some(REVOKED));
    assert_eq!(custom(&chain.edit(1, &Chain::configure_tail(1, 1, 1, &[chain.recipient]))), Some(REVOKED));

    let before = chain.balance(&chain.vault_token);
    let ix = chain.withdraw_ix(&chain.owner.clone(), before);
    assert!(chain.run(&ix).raw_result.is_ok(), "owner withdraws everything after revoke");
    assert_eq!(chain.balance(&chain.vault_token), 0);
}

#[test]
fn funding_and_policy_edits_never_reset_counters() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    assert!(chain.pay(1, 1_000).raw_result.is_ok());
    assert!(chain.pay(2, 1_000).raw_result.is_ok());
    chain.fund(5_000);
    assert_eq!(chain.spent(), (2_000, 2_000));
    assert_eq!(custom(&chain.pay(3, 1)), Some(DAILY), "funding does not raise the daily room");

    let recipients = [chain.recipient];
    assert!(chain.edit(1, &Chain::configure_tail(500, 2_500, 1_500, &recipients)).raw_result.is_ok());
    assert_eq!(chain.spent(), (2_000, 2_000));
    assert_eq!(custom(&chain.pay(4, 1)), Some(LIFETIME), "daily has room, but lifetime lowered below spend leaves zero room");

    assert_eq!(custom(&chain.edit(1, &Chain::configure_tail(0, 1, 1, &recipients))), Some(INVALID_POLICY));
    let mut too_many = Vec::new();
    for _ in 0..9 {
        too_many.push(Pubkey::new_unique());
    }
    assert_eq!(custom(&chain.edit(1, &Chain::configure_tail(1, 1, 1, &too_many))), Some(13));
}

#[test]
fn empty_allowlist_allows_nobody() {
    let mut chain = Chain::new();
    let mut policy = chain.standard_policy();
    policy.recipients.clear();
    chain.init(policy);
    assert_eq!(custom(&chain.pay(1, 1)), Some(RECIPIENT));
}

#[test]
fn lifetime_counter_overflow_is_rejected() {
    let mut chain = Chain::new();
    let policy = Policy { per: u64::MAX, daily: u64::MAX, lifetime: u64::MAX, start: 0, expiry: i64::MAX, recipients: vec![chain.recipient] };
    chain.init(policy);
    let vault = chain.accounts.get_mut(&chain.vault).unwrap();
    vault.data[LIFETIME_SPENT..LIFETIME_SPENT + 8].copy_from_slice(&(u64::MAX - 1).to_le_bytes());
    assert_eq!(custom(&chain.pay(1, 2)), Some(OVERFLOW));
}

#[test]
fn failed_token_transfer_leaves_no_receipt_and_no_spend() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    let token = ata(&chain.recipient, &chain.mint);
    chain.accounts.get_mut(&token).unwrap().data[108] = 2; // frozen
    let result = chain.pay(1, 10);
    assert_eq!(custom(&result), Some(TOKEN_ACCOUNT_FROZEN), "the SPL Token CPI failed after policy checks passed");
    assert_eq!(chain.spent(), (0, 0));
    assert!(chain.data(&chain.receipt(&[1; 32])).is_empty());
}

#[test]
fn owner_can_withdraw_while_paused_without_creating_allowance() {
    let mut chain = Chain::new();
    let policy = chain.standard_policy();
    chain.init(policy);
    assert!(chain.edit(2, &[1]).raw_result.is_ok());
    let before = chain.balance(&chain.vault_token);
    let ix = chain.withdraw_ix(&chain.owner.clone(), 10);
    assert!(chain.run(&ix).raw_result.is_ok());
    assert_eq!(chain.balance(&chain.vault_token), before - 10);
    assert_eq!(chain.spent(), (0, 0));
    let ix = chain.withdraw_ix(&chain.owner.clone(), 0);
    assert_eq!(custom(&chain.run(&ix)), Some(ZERO));
}
