#[test_only]
module marketplace_addr::test_marketplace {
    use std::string;
    use std::vector;
    use aptos_framework::account;
    use aptos_framework::aptos_coin::{Self, AptosCoin};
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use marketplace_addr::dataset_registry;
    use marketplace_addr::marketplace;

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Full setup. Returns BurnCap/MintCap so tests can mint APT.
    fun setup_with_caps(
        deployer: &signer,
        framework: &signer,
    ): (coin::BurnCapability<AptosCoin>, coin::MintCapability<AptosCoin>) {
        timestamp::set_time_has_started_for_testing(framework);
        // AptosCoin must be initialized before marketplace::init_module
        // calls coin::register<AptosCoin>.
        let (burn_cap, mint_cap) = aptos_coin::initialize_for_test(framework);
        dataset_registry::init_module_for_test(deployer);
        marketplace::init_module_for_test(deployer);
        (burn_cap, mint_cap)
    }

    /// Setup for tests that don't need APT minting.
    fun setup(deployer: &signer, framework: &signer) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    fun mint_apt(
        mint_cap: &coin::MintCapability<AptosCoin>,
        to: &signer,
        amount: u64,
    ) {
        coin::register<AptosCoin>(to);
        let coins = coin::mint<AptosCoin>(amount, mint_cap);
        coin::deposit(std::signer::address_of(to), coins);
    }

    fun fake_commitment(): vector<u8> {
        vector[
            1u8, 2, 3, 4, 5, 6, 7, 8,
            1, 2, 3, 4, 5, 6, 7, 8,
            1, 2, 3, 4, 5, 6, 7, 8,
            1, 2, 3, 4, 5, 6, 7, 8,
        ]
    }

    fun register_test_dataset(owner: &signer, price: u64) {
        dataset_registry::register_dataset(
            owner,
            string::utf8(b"Test Dataset"),
            string::utf8(b"A test dataset description"),
            string::utf8(b"0xabc/datasets/test"),
            fake_commitment(),
            1024,
            price,
            vector::empty<std::string::String>(),
            string::utf8(b"MIT"),
        );
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_init(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        assert!(dataset_registry::get_dataset_count() == 0, 0);
        assert!(marketplace::get_platform_fee_bps() == 250, 1);
        assert!(marketplace::get_total_volume() == 0, 2);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_register_dataset(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        let tags = vector[string::utf8(b"nlp"), string::utf8(b"text")];
        dataset_registry::register_dataset(
            deployer,
            string::utf8(b"My Dataset"),
            string::utf8(b"A great NLP dataset"),
            string::utf8(b"0xabc/datasets/my-dataset"),
            fake_commitment(),
            1024 * 1024,
            1_000_000,
            tags,
            string::utf8(b"CC-BY-4.0"),
        );
        assert!(dataset_registry::get_dataset_count() == 1, 0);

        let dataset_addr = dataset_registry::get_dataset_address(0);
        assert!(dataset_registry::is_active(dataset_addr), 1);
        assert!(dataset_registry::get_price(dataset_addr) == 1_000_000, 2);
        assert!(dataset_registry::get_download_count(dataset_addr) == 0, 3);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    fun test_purchase_paid_dataset(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);

        mint_apt(&mint_cap, buyer, 100_000_000); // 1 APT

        let price = 10_000_000u64; // 0.1 APT
        register_test_dataset(deployer, price);

        let dataset_addr = dataset_registry::get_dataset_address(0);
        assert!(!marketplace::has_access(buyer_addr, dataset_addr), 0);

        marketplace::purchase_dataset(buyer, dataset_addr);

        assert!(marketplace::has_access(buyer_addr, dataset_addr), 1);
        assert!(dataset_registry::get_download_count(dataset_addr) == 1, 2);

        let platform_fee = price * 250 / 10000;
        let seller_share = price - platform_fee;
        assert!(marketplace::get_platform_accumulated() == platform_fee, 3);
        assert!(
            marketplace::get_seller_earnings(std::signer::address_of(deployer)) == seller_share,
            4,
        );
        assert!(marketplace::get_total_volume() == price, 5);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_free_dataset(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 0); // price = 0 = free

        let dataset_addr = dataset_registry::get_dataset_address(0);
        // Seller can't buy their own, so use deployer address just to verify the dataset exists
        assert!(dataset_registry::get_price(dataset_addr) == 0, 0);
        assert!(dataset_registry::is_active(dataset_addr), 1);
        // Volume should stay zero for free datasets
        assert!(marketplace::get_total_volume() == 0, 2);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    #[expected_failure(abort_code = 1, location = marketplace_addr::marketplace)]
    fun test_double_purchase_fails(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);
        mint_apt(&mint_cap, buyer, 100_000_000);

        register_test_dataset(deployer, 5_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        marketplace::purchase_dataset(buyer, dataset_addr);
        // E_ALREADY_PURCHASED = 1
        marketplace::purchase_dataset(buyer, dataset_addr);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 6, location = marketplace_addr::marketplace)]
    fun test_self_purchase_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        // E_SELF_PURCHASE = 6
        marketplace::purchase_dataset(deployer, dataset_addr);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 1, location = marketplace_addr::dataset_registry)]
    fun test_unauthorized_price_update_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        let rando = account::create_account_for_test(@0x99);
        // E_NOT_OWNER = 1
        dataset_registry::update_price(&rando, dataset_addr, 0);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_deactivate_reactivate(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);

        assert!(dataset_registry::is_active(dataset_addr), 0);
        dataset_registry::deactivate_dataset(deployer, dataset_addr);
        assert!(!dataset_registry::is_active(dataset_addr), 1);
        dataset_registry::reactivate_dataset(deployer, dataset_addr);
        assert!(dataset_registry::is_active(dataset_addr), 2);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    #[expected_failure(abort_code = 2, location = marketplace_addr::marketplace)]
    fun test_purchase_inactive_dataset_fails(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);
        mint_apt(&mint_cap, buyer, 100_000_000);

        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        dataset_registry::deactivate_dataset(deployer, dataset_addr);
        // E_DATASET_NOT_ACTIVE = 2
        marketplace::purchase_dataset(buyer, dataset_addr);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 5, location = marketplace_addr::marketplace)]
    fun test_fee_too_high_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        // E_INVALID_FEE = 5 — 11% exceeds max 10%
        marketplace::set_platform_fee(deployer, 1100);
    }

    // ── Free dataset purchase by a non-owner buyer ────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    fun test_purchase_free_dataset_by_buyer(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);
        mint_apt(&mint_cap, buyer, 100_000_000);
        let balance_before = coin::balance<AptosCoin>(buyer_addr);

        register_test_dataset(deployer, 0); // price = 0 = free
        let dataset_addr = dataset_registry::get_dataset_address(0);

        marketplace::purchase_dataset(buyer, dataset_addr);

        assert!(marketplace::has_access(buyer_addr, dataset_addr), 0);
        assert!(dataset_registry::get_download_count(dataset_addr) == 1, 1);
        // No APT spent for free dataset
        assert!(coin::balance<AptosCoin>(buyer_addr) == balance_before, 2);
        assert!(marketplace::get_platform_accumulated() == 0, 3);
        assert!(marketplace::get_total_volume() == 0, 4);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    // ── Seller earnings withdrawal ────────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    fun test_withdraw_earnings(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let deployer_addr = std::signer::address_of(deployer);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);
        mint_apt(&mint_cap, buyer, 100_000_000);
        // Register a CoinStore on the deployer so they can receive earnings.
        coin::register<AptosCoin>(deployer);
        let seller_balance_before = coin::balance<AptosCoin>(deployer_addr);

        let price = 10_000_000u64;
        register_test_dataset(deployer, price);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        marketplace::purchase_dataset(buyer, dataset_addr);

        let platform_fee = price * 250 / 10000;
        let seller_share = price - platform_fee;
        assert!(marketplace::get_seller_earnings(deployer_addr) == seller_share, 0);

        marketplace::withdraw_earnings(deployer);

        // Earnings ledger cleared
        assert!(marketplace::get_seller_earnings(deployer_addr) == 0, 1);
        // APT received by seller
        assert!(coin::balance<AptosCoin>(deployer_addr) == seller_balance_before + seller_share, 2);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 4, location = marketplace_addr::marketplace)]
    fun test_withdraw_earnings_no_earnings_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        // Seller with no entry in earnings table — E_NO_EARNINGS = 4
        marketplace::withdraw_earnings(deployer);
    }

    // ── Platform earnings withdrawal ──────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, buyer = @0x42)]
    fun test_withdraw_platform_earnings(
        deployer: &signer,
        framework: &signer,
        buyer: &signer,
    ) {
        let (burn_cap, mint_cap) = setup_with_caps(deployer, framework);
        let deployer_addr = std::signer::address_of(deployer);
        let buyer_addr = std::signer::address_of(buyer);
        account::create_account_for_test(buyer_addr);
        mint_apt(&mint_cap, buyer, 100_000_000);
        coin::register<AptosCoin>(deployer);
        let admin_balance_before = coin::balance<AptosCoin>(deployer_addr);

        let price = 10_000_000u64;
        register_test_dataset(deployer, price);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        marketplace::purchase_dataset(buyer, dataset_addr);

        let platform_fee = price * 250 / 10000;
        assert!(marketplace::get_platform_accumulated() == platform_fee, 0);

        marketplace::withdraw_platform_earnings(deployer);

        assert!(marketplace::get_platform_accumulated() == 0, 1);
        assert!(coin::balance<AptosCoin>(deployer_addr) == admin_balance_before + platform_fee, 2);

        coin::destroy_burn_cap(burn_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 7, location = marketplace_addr::marketplace)]
    fun test_withdraw_platform_earnings_zero_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        // No purchases yet — E_NO_PLATFORM_EARNINGS = 7
        marketplace::withdraw_platform_earnings(deployer);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, rando = @0x99)]
    #[expected_failure(abort_code = 3, location = marketplace_addr::marketplace)]
    fun test_withdraw_platform_earnings_non_admin_fails(
        deployer: &signer,
        framework: &signer,
        rando: &signer,
    ) {
        setup(deployer, framework);
        // E_NOT_ADMIN = 3
        marketplace::withdraw_platform_earnings(rando);
    }

    // ── set_platform_fee (success + non-admin) ────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_set_platform_fee(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        assert!(marketplace::get_platform_fee_bps() == 250, 0);
        marketplace::set_platform_fee(deployer, 500); // 5%
        assert!(marketplace::get_platform_fee_bps() == 500, 1);
        marketplace::set_platform_fee(deployer, 0);   // free platform
        assert!(marketplace::get_platform_fee_bps() == 0, 2);
        marketplace::set_platform_fee(deployer, 1000); // max
        assert!(marketplace::get_platform_fee_bps() == 1000, 3);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, rando = @0x99)]
    #[expected_failure(abort_code = 3, location = marketplace_addr::marketplace)]
    fun test_set_platform_fee_non_admin_fails(
        deployer: &signer,
        framework: &signer,
        rando: &signer,
    ) {
        setup(deployer, framework);
        // E_NOT_ADMIN = 3 (fee value is valid, so fee check passes first)
        marketplace::set_platform_fee(rando, 100);
    }

    // ── transfer_admin ────────────────────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, new_admin = @0x99)]
    fun test_transfer_admin(
        deployer: &signer,
        framework: &signer,
        new_admin: &signer,
    ) {
        setup(deployer, framework);
        let new_admin_addr = std::signer::address_of(new_admin);
        assert!(marketplace::get_admin() == std::signer::address_of(deployer), 0);

        marketplace::transfer_admin(deployer, new_admin_addr);
        assert!(marketplace::get_admin() == new_admin_addr, 1);

        // New admin can exercise admin functions
        marketplace::set_platform_fee(new_admin, 300);
        assert!(marketplace::get_platform_fee_bps() == 300, 2);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 8, location = marketplace_addr::marketplace)]
    fun test_transfer_admin_zero_address_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        // E_ZERO_ADDRESS = 8
        marketplace::transfer_admin(deployer, @0x0);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework, rando = @0x99)]
    #[expected_failure(abort_code = 3, location = marketplace_addr::marketplace)]
    fun test_transfer_admin_non_admin_fails(
        deployer: &signer,
        framework: &signer,
        rando: &signer,
    ) {
        setup(deployer, framework);
        // E_NOT_ADMIN = 3
        marketplace::transfer_admin(rando, @0x99);
    }

    // ── update_description ────────────────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_update_description(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        dataset_registry::update_description(
            deployer,
            dataset_addr,
            string::utf8(b"Revised and improved description for this dataset"),
        );
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 1, location = marketplace_addr::dataset_registry)]
    fun test_update_description_unauthorized_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        let rando = account::create_account_for_test(@0x99);
        // E_NOT_OWNER = 1
        dataset_registry::update_description(&rando, dataset_addr, string::utf8(b"Hacked"));
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 2, location = marketplace_addr::dataset_registry)]
    fun test_update_description_empty_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        // E_EMPTY_STRING = 2
        dataset_registry::update_description(deployer, dataset_addr, string::utf8(b""));
    }

    // ── update_price ──────────────────────────────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    fun test_update_price(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);

        assert!(dataset_registry::get_price(dataset_addr) == 1_000_000, 0);
        dataset_registry::update_price(deployer, dataset_addr, 5_000_000);
        assert!(dataset_registry::get_price(dataset_addr) == 5_000_000, 1);
        // Make it free
        dataset_registry::update_price(deployer, dataset_addr, 0);
        assert!(dataset_registry::get_price(dataset_addr) == 0, 2);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 9, location = marketplace_addr::dataset_registry)]
    fun test_update_price_too_high_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        // E_PRICE_TOO_HIGH = 9 — exceeds MAX_PRICE_OCTAS (1,000,000 APT)
        dataset_registry::update_price(deployer, dataset_addr, 100_000_000_000_001);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 9, location = marketplace_addr::dataset_registry)]
    fun test_register_price_too_high_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        // E_PRICE_TOO_HIGH = 9 at registration time
        register_test_dataset(deployer, 100_000_000_000_001);
    }

    // ── Unauthorized deactivate / reactivate ──────────────────────────────────

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 1, location = marketplace_addr::dataset_registry)]
    fun test_deactivate_unauthorized_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        let rando = account::create_account_for_test(@0x99);
        // E_NOT_OWNER = 1
        dataset_registry::deactivate_dataset(&rando, dataset_addr);
    }

    #[test(deployer = @marketplace_addr, framework = @aptos_framework)]
    #[expected_failure(abort_code = 1, location = marketplace_addr::dataset_registry)]
    fun test_reactivate_unauthorized_fails(deployer: &signer, framework: &signer) {
        setup(deployer, framework);
        register_test_dataset(deployer, 1_000_000);
        let dataset_addr = dataset_registry::get_dataset_address(0);
        dataset_registry::deactivate_dataset(deployer, dataset_addr);
        let rando = account::create_account_for_test(@0x99);
        // E_NOT_OWNER = 1
        dataset_registry::reactivate_dataset(&rando, dataset_addr);
    }
}
