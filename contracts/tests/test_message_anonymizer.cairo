use message_anonymizer::message_anonymizer::{
    EncryptedMessage, IMessageAnonymizerDispatcher, IMessageAnonymizerDispatcherTrait,
    IMessageAnonymizerSafeDispatcher, IMessageAnonymizerSafeDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::vectors_gen;

fn pool_address() -> ContractAddress {
    0x9001.try_into().unwrap()
}

fn deploy() -> IMessageAnonymizerDispatcher {
    let contract = declare("MessageAnonymizer").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![pool_address().into()]).unwrap();
    IMessageAnonymizerDispatcher { contract_address: address }
}

fn as_pool(d: IMessageAnonymizerDispatcher) {
    start_cheat_caller_address(d.contract_address, pool_address());
}

fn msg(id: felt252, ct: Span<felt252>) -> EncryptedMessage {
    EncryptedMessage { msg_id: id, ciphertext: ct }
}

// --- happy paths ---------------------------------------------------------

#[test]
fn test_write_and_read_back_frozen_vector() {
    let d = deploy();
    let (id, felts) = vectors_gen::sealed_0();

    as_pool(d);
    let deposits = d.privacy_invoke(array![msg(id, felts)].span());
    stop_cheat_caller_address(d.contract_address);

    assert!(deposits.is_empty(), "deposits span must be empty for a pure message");
    assert_eq!(d.slot_len(id), felts.len());
    assert_eq!(d.slots(id), felts);
    let mut i: u32 = 0;
    for f in felts {
        assert_eq!(d.slot(id, i), *f);
        i += 1;
    }
}

#[test]
fn test_batch_write_multiple_messages() {
    let d = deploy();
    let (id0, felts0) = vectors_gen::sealed_0();
    let (id1, felts1) = vectors_gen::sealed_1();

    as_pool(d);
    d.privacy_invoke(array![msg(id0, felts0), msg(id1, felts1), msg(0xc0ffee, [1, 2].span())].span());
    stop_cheat_caller_address(d.contract_address);

    assert_eq!(d.slots(id0), felts0);
    assert_eq!(d.slots(id1), felts1);
    assert_eq!(d.slots(0xc0ffee), [1, 2].span());
}

#[test]
fn test_empty_slot_reads_as_zero_len() {
    let d = deploy();
    // 0 length is the dense-walk terminator; must hold for any untouched id.
    assert_eq!(d.slot_len(0xdead), 0);
    assert_eq!(d.slots(0xdead), [].span());
}

#[test]
fn test_slot_lens_batched() {
    let d = deploy();
    let (id, felts) = vectors_gen::sealed_0();
    as_pool(d);
    d.privacy_invoke(array![msg(id, felts)].span());
    stop_cheat_caller_address(d.contract_address);

    let lens = d.slot_lens(array![id, 0xdead, id].span());
    assert_eq!(lens, [felts.len(), 0, felts.len()].span());
}

#[test]
fn test_pool_getter() {
    let d = deploy();
    assert_eq!(d.pool(), pool_address());
}

// --- negative cases (05-contracts.md / 11-implementation.md) --------------

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn test_non_pool_caller_rejected() {
    let d = deploy();
    // no caller cheat: the test contract is not the pool
    d.privacy_invoke(array![msg(0x1, [1].span())].span());
}

#[test]
#[should_panic(expected: 'SLOT_OCCUPIED')]
fn test_second_write_to_occupied_slot_rejected() {
    let d = deploy();
    as_pool(d);
    d.privacy_invoke(array![msg(0x1, [1].span())].span());
    d.privacy_invoke(array![msg(0x1, [2].span())].span());
}

#[test]
#[should_panic(expected: 'SLOT_OCCUPIED')]
fn test_duplicate_id_within_one_batch_rejected() {
    let d = deploy();
    as_pool(d);
    d.privacy_invoke(array![msg(0x1, [1].span()), msg(0x1, [2].span())].span());
}

#[test]
#[should_panic(expected: 'EMPTY_PAYLOAD')]
fn test_empty_ciphertext_rejected() {
    let d = deploy();
    as_pool(d);
    d.privacy_invoke(array![msg(0x1, [].span())].span());
}

#[test]
#[should_panic(expected: 'NO_MESSAGES')]
fn test_empty_batch_rejected() {
    let d = deploy();
    as_pool(d);
    d.privacy_invoke([].span());
}

#[test]
fn test_zero_pool_constructor_rejected() {
    let contract = declare("MessageAnonymizer").unwrap().contract_class();
    assert!(contract.deploy(@array![0]).is_err(), "zero pool address must be rejected");
}

// --- atomicity ------------------------------------------------------------

#[test]
#[feature("safe_dispatcher")]
fn test_failed_batch_writes_nothing() {
    let d = deploy();
    let (id, felts) = vectors_gen::sealed_0();

    as_pool(d);
    // occupy 0x1 first
    d.privacy_invoke(array![msg(0x1, [9].span())].span());

    // batch where the SECOND message collides: the call frame reverts, so the
    // first message must not land either.
    let safe = IMessageAnonymizerSafeDispatcher { contract_address: d.contract_address };
    match safe.privacy_invoke(array![msg(id, felts), msg(0x1, [8].span())].span()) {
        Result::Ok(_) => core::panic_with_felt252('colliding batch must revert'),
        Result::Err(_) => {},
    }
    stop_cheat_caller_address(d.contract_address);
    assert_eq!(d.slot_len(id), 0, "reverted batch must write nothing");
}
