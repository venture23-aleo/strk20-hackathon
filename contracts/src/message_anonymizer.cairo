//! Message anonymizer: WriteOnce storage for encrypted message payloads, writable
//! only through the privacy pool's `InvokeExternal` dispatch.
//!
//! The pool calls the fixed selector `privacy_invoke` and deserializes the
//! transaction's invoke calldata directly into its parameters; the returned
//! `Span<OpenNoteDeposit>` is applied by the pool and MUST be empty here — this
//! contract never handles tokens. `caller == pool` is the only access control,
//! and it is also where sender anonymity lives: the helper never sees who
//! initiated the transaction.

use privacy::objects::OpenNoteDeposit;

/// One sealed message: `msg_id = h(MSG_ID_TAG, channel_key, index)` addresses the
/// slot; `ciphertext` is the 31-byte-packed ChaCha20-Poly1305 output.
#[derive(Copy, Drop, Serde)]
pub struct EncryptedMessage {
    pub msg_id: felt252,
    pub ciphertext: Span<felt252>,
}

pub mod errors {
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const SLOT_OCCUPIED: felt252 = 'SLOT_OCCUPIED';
    pub const EMPTY_PAYLOAD: felt252 = 'EMPTY_PAYLOAD';
    pub const NO_MESSAGES: felt252 = 'NO_MESSAGES';
}

#[starknet::interface]
pub trait IMessageAnonymizer<T> {
    /// Store a batch of messages. Callable only by the pool, via `InvokeExternal`.
    fn privacy_invoke(ref self: T, messages: Span<EncryptedMessage>) -> Span<OpenNoteDeposit>;

    /// Number of ciphertext felts stored under `msg_id`; 0 means empty, which is
    /// what terminates the recipient's dense-index walk.
    fn slot_len(self: @T, msg_id: felt252) -> u32;
    /// One ciphertext felt.
    fn slot(self: @T, msg_id: felt252, offset: u32) -> felt252;
    /// The whole ciphertext in one call.
    fn slots(self: @T, msg_id: felt252) -> Span<felt252>;
    /// Batched walk helper: lengths for many ids in one round trip.
    fn slot_lens(self: @T, msg_ids: Span<felt252>) -> Span<u32>;
    fn pool(self: @T) -> starknet::ContractAddress;
}

#[starknet::contract]
pub mod MessageAnonymizer {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::{EncryptedMessage, IMessageAnonymizer, OpenNoteDeposit, errors};

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// msg_id -> number of ciphertext felts; 0 means empty.
        len: Map<felt252, u32>,
        /// (msg_id, offset) -> ciphertext felt.
        data: Map<(felt252, u32), felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'ZERO_POOL');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    pub impl MessageAnonymizerImpl of IMessageAnonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState, messages: Span<EncryptedMessage>,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::CALLER_NOT_POOL);
            assert(!messages.is_empty(), errors::NO_MESSAGES);

            for m in messages {
                let id = *m.msg_id;
                // Rejecting an occupied slot is a correctness requirement, not
                // hygiene: skipping would leave a gap that silently truncates
                // every future dense-index scan.
                assert(self.len.entry(id).read() == 0, errors::SLOT_OCCUPIED);
                let ct = *m.ciphertext;
                assert(!ct.is_empty(), errors::EMPTY_PAYLOAD);

                let mut i: u32 = 0;
                for felt in ct {
                    self.data.entry((id, i)).write(*felt);
                    i += 1;
                }
                self.len.entry(id).write(ct.len());
            }

            // Pure messages move no tokens; anything but a bare empty span here
            // fails the pool's return-data deserialization.
            array![].span()
        }

        fn slot_len(self: @ContractState, msg_id: felt252) -> u32 {
            self.len.entry(msg_id).read()
        }

        fn slot(self: @ContractState, msg_id: felt252, offset: u32) -> felt252 {
            self.data.entry((msg_id, offset)).read()
        }

        fn slots(self: @ContractState, msg_id: felt252) -> Span<felt252> {
            let n = self.len.entry(msg_id).read();
            let mut out: Array<felt252> = array![];
            let mut i: u32 = 0;
            while i != n {
                out.append(self.data.entry((msg_id, i)).read());
                i += 1;
            }
            out.span()
        }

        fn slot_lens(self: @ContractState, msg_ids: Span<felt252>) -> Span<u32> {
            let mut out: Array<u32> = array![];
            for id in msg_ids {
                out.append(self.len.entry(*id).read());
            }
            out.span()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
    }
}
